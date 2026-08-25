import { extractTag, extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useRelayStatus as subscribeToRelayStatus, useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { isNewerAnchor, parseCommunityAnchor, parsePriceTag, type CommunityAnchor } from "@/access/nip97";
import { fetchRelayRootPubkey, trustFromAnchor } from "@/access/trust";
import { getNostrRuntime } from "@/nostr/manager";
import { KIND_ANCHOR, KIND_BADGE_DEFINITION, KIND_VENUE_PROFILE } from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";

import {
  foldMemberships,
  foldRoomManifest,
  foldVenueProfile,
  type MembershipInput,
  type MembershipPlan,
  type RoomManifest,
  type RoomManifestInput,
  type VenueProfile,
  type VenueProfileInput,
} from "./fold";
import { ROOM_MANIFEST_D_PREFIX, VENUE_PROFILE_D } from "./protocol";

export type RelayReachability = "unknown" | "connected" | "unreachable";

export type SettingsData = {
  status: "loading" | "ready" | "error";
  error?: string;
  profile: VenueProfile | null;
  memberships: MembershipPlan[];
  room: RoomManifest | null;
  /** Subscription connection truth for the active venue relay (ROOM-01). */
  relayReachable: RelayReachability;
  /** Projection clock (seconds); refreshed on a slow ticker. */
  now: number;
};

type Buffer = {
  anchor: CommunityAnchor | null;
  profiles: Map<string, VenueProfileInput>;
  memberships: Map<string, MembershipInput>;
  roomManifests: Map<string, RoomManifestInput>;
};

const emptyBuffer = (): Buffer => ({
  anchor: null,
  profiles: new Map(),
  memberships: new Map(),
  roomManifests: new Map(),
});

function isNewer(previous: { id: string; createdAt: number } | undefined, id: string, createdAt: number): boolean {
  return (
    !previous ||
    createdAt > previous.createdAt ||
    (createdAt === previous.createdAt && id > previous.id)
  );
}

/**
 * Subscription coordinator for the settings sections. Owns one stable
 * subscription (`board_settings_<sanitized relay>`, kinds 30009/30078/31727),
 * extracts plain inputs at the worker boundary, and folds them through the
 * pure projections in fold.ts. EOSE is the loaded signal; cleanup
 * unsubscribes on unmount, venue change, and backgrounding.
 *
 * NIP-97 trust chain: the relay's NIP-11 pubkey is the community root key;
 * the root-signed anchor event in the subscription declares the admins whose
 * definitions count. Projections stay empty until the anchor resolves.
 */
export function useSettingsData(): SettingsData {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;

  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rootPubkey, setRootPubkey] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [relayReachable, setRelayReachable] = useState<RelayReachability>("unknown");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // The venue relay's NIP-11 document publishes the community root key; the
  // subscription below stays closed until it resolves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRootPubkey(null);
    setError(null);
    if (!relayUrl) return;
    let cancelled = false;
    fetchRelayRootPubkey(relayUrl)
      .then((pubkey) => {
        if (!cancelled) setRootPubkey(pubkey);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The venue relay did not answer.");
      });
    return () => {
      cancelled = true;
    };
  }, [relayUrl]);

  // Relay reachability comes from the subscription connection status only —
  // never from manifest or hardware records (ROOM-02 separation).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRelayReachable("unknown");
    if (!relayUrl) return;
    return subscribeToRelayStatus((status, url) => {
      if (url !== relayUrl) return;
      if (status === "connected") setRelayReachable("connected");
      else setRelayReachable("unreachable");
    });
  }, [relayUrl]);

  // Slow projection clock for manifest freshness/expiry.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBuffer(emptyBuffer());
    setLoaded(false);
    if (!relayUrl || !rootPubkey) return;
    if (!getNostrRuntime().manager) {
      setError("The secure Nostr engine is unavailable. Use a Crays development build.");
      return;
    }

    let unsubscribe: () => void = () => {};
    let subscribeTimer: ReturnType<typeof setTimeout> | null = null;
    let eoseFallback: ReturnType<typeof setTimeout> | null = null;
    let subscribed = false;

    const stop = () => {
      if (subscribeTimer) clearTimeout(subscribeTimer);
      if (eoseFallback) clearTimeout(eoseFallback);
      subscribeTimer = null;
      eoseFallback = null;
      if (subscribed) unsubscribe();
      unsubscribe = () => {};
      subscribed = false;
    };

    const handleMessage = (message: WorkerMessage) => {
      if (isEoce(message)) {
        setLoaded(true);
        return;
      }
      const event = isParsedEvent(message);
      if (!event) return;
      const kind = event.kind();

      if (kind === KIND_ANCHOR) {
        // Trust root: only the anchor signed by the relay's NIP-11 root key.
        const anchor = parseCommunityAnchor(event);
        if (!anchor || anchor.pubkey !== rootPubkey) return;
        setBuffer((current) =>
          !current.anchor || isNewerAnchor(anchor, current.anchor) ? { ...current, anchor } : current,
        );
        return;
      }

      const id = event.id() ?? "";
      const author = (event.pubkey() ?? "").toLowerCase();
      const d = extractTagValue(event, "d") ?? "";
      if (!id || !author || !d) return;
      const createdAt = event.createdAt();

      if (kind === KIND_VENUE_PROFILE && d === VENUE_PROFILE_D) {
        const profile: VenueProfileInput = {
          id,
          authorPubkey: author,
          createdAt,
          ...(extractTagValue(event, "name") ? { venueName: extractTagValue(event, "name") } : {}),
          ...(extractTagValue(event, "type") ? { hospitalityType: extractTagValue(event, "type") } : {}),
          ...(extractTagValue(event, "about") ? { description: extractTagValue(event, "about") } : {}),
          ...(extractTagValue(event, "menu_url") ? { menuUrl: extractTagValue(event, "menu_url") } : {}),
          ...(extractTagValue(event, "booking_url") ? { bookingUrl: extractTagValue(event, "booking_url") } : {}),
        };
        setBuffer((current) =>
          isNewer(current.profiles.get(d), id, createdAt)
            ? { ...current, profiles: new Map(current.profiles).set(d, profile) }
            : current,
        );
        return;
      }

      if (kind === KIND_VENUE_PROFILE && d.startsWith(ROOM_MANIFEST_D_PREFIX)) {
        const expiration = Number(extractTagValue(event, "expiration"));
        const manifest: RoomManifestInput = {
          id,
          authorPubkey: author,
          d,
          capabilities: extractTagValues(event, "capability"),
          createdAt,
          ...(extractTagValue(event, "schema") ? { schema: extractTagValue(event, "schema") } : {}),
          ...(extractTagValue(event, "name") ? { name: extractTagValue(event, "name") } : {}),
          ...(extractTagValue(event, "operator") ? { operator: (extractTagValue(event, "operator") ?? "").toLowerCase() } : {}),
          ...(extractTagValue(event, "open") ? { open: extractTagValue(event, "open") } : {}),
          ...(extractTagValue(event, "award_issuer")
            ? { advertisedIssuer: (extractTagValue(event, "award_issuer") ?? "").toLowerCase() }
            : {}),
          ...(Number.isSafeInteger(expiration) && expiration > 0 ? { expiresAt: expiration } : {}),
        };
        setBuffer((current) =>
          isNewer(current.roomManifests.get(d), id, createdAt)
            ? { ...current, roomManifests: new Map(current.roomManifests).set(d, manifest) }
            : current,
        );
        return;
      }

      if (kind === KIND_BADGE_DEFINITION && extractTagValues(event, "t").includes("membership")) {
        // NIP-97: membership *plans* are badge definitions on the membership
        // topic carrying a well-formed NIP-99 price tag. The fold keeps
        // anchor-admin authors only, so the relay node's root-authored
        // members invite-badge definition stays out of the editable list.
        const priceTag = extractTag(event, "price");
        const price = parsePriceTag(event);
        if (!priceTag || !price) return;
        const membership: MembershipInput = {
          address: `${KIND_BADGE_DEFINITION}:${author}:${d}`,
          id,
          authorPubkey: author,
          d,
          price: priceTag[1],
          currency: price.currency,
          createdAt,
          ...(extractTagValue(event, "name") ? { name: extractTagValue(event, "name") } : {}),
          ...(extractTagValue(event, "description") ? { description: extractTagValue(event, "description") } : {}),
          ...(price.recurrence ? { recurrence: price.recurrence } : {}),
          ...(extractTagValue(event, "availability") ? { availability: extractTagValue(event, "availability") } : {}),
        };
        setBuffer((current) =>
          isNewer(current.memberships.get(membership.address), id, createdAt)
            ? { ...current, memberships: new Map(current.memberships).set(membership.address, membership) }
            : current,
        );
      }
    };

    const startAfterForegroundSettles = () => {
      stop();
      subscribeTimer = setTimeout(() => {
        subscribeTimer = null;
        const subId = `board_settings_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [
            {
              kinds: [KIND_VENUE_PROFILE, KIND_BADGE_DEFINITION, KIND_ANCHOR],
              relays: [relayUrl],
              limit: 500,
              noCache: true,
            },
          ],
          handleMessage,
          { closeOnEose: false },
        );
        subscribed = true;
        eoseFallback = setTimeout(() => setLoaded(true), 12_000);
      }, 350);
    };

    if (AppState.currentState === "active") startAfterForegroundSettles();
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") startAfterForegroundSettles();
      else stop();
    });

    return () => {
      appStateSubscription.remove();
      stop();
    };
  }, [relayUrl, rootPubkey]);

  const trust = useMemo(() => (buffer.anchor ? trustFromAnchor(buffer.anchor) : null), [buffer.anchor]);
  const profile = useMemo(
    () => (trust ? foldVenueProfile([...buffer.profiles.values()], trust) : null),
    [buffer.profiles, trust],
  );
  const memberships = useMemo(
    () => (trust ? foldMemberships([...buffer.memberships.values()], trust) : []),
    [buffer.memberships, trust],
  );
  const room = useMemo(
    () => (trust ? foldRoomManifest([...buffer.roomManifests.values()], now, trust) : null),
    [buffer.roomManifests, now, trust],
  );

  if (restoring) return { status: "loading", profile: null, memberships: [], room: null, relayReachable, now };
  if (error) return { status: "error", error, profile: null, memberships: [], room: null, relayReachable, now };
  if (!venue) return { status: "ready", profile: null, memberships: [], room: null, relayReachable, now };
  if (!loaded || !trust) return { status: "loading", profile: null, memberships: [], room: null, relayReachable, now };
  return { status: "ready", profile, memberships, room, relayReachable, now };
}
