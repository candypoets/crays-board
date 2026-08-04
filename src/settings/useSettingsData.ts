import { extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useRelayStatus as subscribeToRelayStatus, useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getNostrRuntime } from "@/nostr/manager";
import { KIND_DEFINITION, KIND_VENUE_PROFILE } from "@/nostr/protocol";
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
  profiles: Map<string, VenueProfileInput>;
  memberships: Map<string, MembershipInput>;
  roomManifests: Map<string, RoomManifestInput>;
};

const emptyBuffer = (): Buffer => ({
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
 * subscription (`board_settings_<sanitized relay>`, kinds 30009/30078),
 * extracts plain inputs at the worker boundary, and folds them through the
 * pure projections in fold.ts. EOSE is the loaded signal; cleanup
 * unsubscribes on unmount, venue change, and backgrounding.
 */
export function useSettingsData(): SettingsData {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;

  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [relayReachable, setRelayReachable] = useState<RelayReachability>("unknown");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

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
    if (!relayUrl) return;
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

      if (kind === KIND_DEFINITION && extractTagValue(event, "type") === "membership") {
        // §3.4: membership *plans* are sellable definitions with price and
        // period. Non-sellable membership definitions (e.g. the relay's
        // internal badge definition) are not staff-editable plans.
        if (!extractTagValues(event, "t").includes("sellable")) return;
        const membership: MembershipInput = {
          address: `${KIND_DEFINITION}:${author}:${d}`,
          id,
          authorPubkey: author,
          d,
          price: extractTagValue(event, "price") ?? "",
          currency: extractTagValue(event, "currency") ?? "",
          createdAt,
          ...(extractTagValue(event, "name") ? { name: extractTagValue(event, "name") } : {}),
          ...(extractTagValue(event, "description") ? { description: extractTagValue(event, "description") } : {}),
          ...(extractTagValue(event, "period") ? { period: extractTagValue(event, "period") } : {}),
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
          [{ kinds: [KIND_VENUE_PROFILE, KIND_DEFINITION], relays: [relayUrl], limit: 500, noCache: true }],
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
  }, [relayUrl]);

  const profile = useMemo(() => foldVenueProfile([...buffer.profiles.values()]), [buffer.profiles]);
  const memberships = useMemo(() => foldMemberships([...buffer.memberships.values()]), [buffer.memberships]);
  const room = useMemo(() => foldRoomManifest([...buffer.roomManifests.values()], now), [buffer.roomManifests, now]);

  if (restoring) return { status: "loading", profile: null, memberships: [], room: null, relayReachable, now };
  if (error) return { status: "error", error, profile: null, memberships: [], room: null, relayReachable, now };
  if (!venue) return { status: "ready", profile: null, memberships: [], room: null, relayReachable, now };
  if (!loaded) return { status: "loading", profile: null, memberships: [], room: null, relayReachable, now };
  return { status: "ready", profile, memberships, room, relayReachable, now };
}
