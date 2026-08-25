import { extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import {
  deriveOrderRef,
  entitlementTypeFor,
  isNewerAnchor,
  isSellableDefinition,
  orderContextKey,
  parseCommunityAnchor,
  parsePermissionTags,
  parseStatusContext,
  type CommunityAnchor,
} from "@/access/nip97";
import { fetchRelayRootPubkey, trustFromAnchor } from "@/access/trust";
import { getNostrRuntime } from "@/nostr/manager";
import {
  KIND_ANCHOR,
  KIND_AWARD,
  KIND_BADGE_DEFINITION,
  KIND_LISTING,
  KIND_REVOCATION,
  KIND_STATUS,
  KIND_VENUE_PROFILE,
  type PublishedOrderStatus,
} from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";

import {
  homeMarkerPayload,
  projectHomeSummary,
  KIND_CALENDAR_EVENT,
  type HomeAwardInput,
  type HomeCalendarEventInput,
  type HomeDefinitionInput,
  type HomeProfileInput,
  type HomeStatusInput,
  type HomeSummary,
} from "./summary";

export type HomeResult = {
  status: "loading" | "ready" | "error";
  /** Live = venue trust resolved and the relay subscription is open. */
  live: boolean;
  summary: HomeSummary | null;
  error?: string;
};

type Buffer = {
  awards: Map<string, HomeAwardInput>;
  definitions: Map<string, HomeDefinitionInput>;
  statuses: Map<string, HomeStatusInput>;
  calendarEvents: Map<string, HomeCalendarEventInput>;
  deletions: Map<string, { id: string; authorPubkey: string; references: string[]; createdAt: number }>;
  profiles: Map<string, HomeProfileInput>;
  /** Latest root-signed community anchor (NIP-97 trust source). */
  anchor: CommunityAnchor | null;
};

const emptyBuffer = (): Buffer => ({
  awards: new Map(),
  definitions: new Map(),
  statuses: new Map(),
  calendarEvents: new Map(),
  deletions: new Map(),
  profiles: new Map(),
  anchor: null,
});

const HOME_KINDS = [
  KIND_AWARD,
  KIND_BADGE_DEFINITION,
  KIND_LISTING,
  KIND_STATUS,
  KIND_VENUE_PROFILE,
  KIND_CALENDAR_EVENT,
  KIND_REVOCATION,
  KIND_ANCHOR,
];

const PUBLISHED_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "processing",
  "ready",
  "fulfilled",
  "cancelled",
]);

/**
 * Subscription coordinator for the Home attention summary (PRD §8.3). Owns
 * exactly one stable subscription (`board_home_<sanitized relay>`), extracts
 * plain NIP-97 inputs at the worker boundary, and folds them through the
 * pure projection in summary.ts. Trust is NIP-97: the relay's NIP-11 root
 * key authenticates the latest anchor event, which declares the admins and
 * the delegated badge issuer. EOSE is the loaded signal. Cleanup
 * unsubscribes on unmount, venue change, and backgrounding.
 */
export function useHomeSummary(): HomeResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;

  const [rootPubkey, setRootPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // NIP-97 trust root: the venue relay's NIP-11 community key. Only the
  // anchor signed by this key declares the venue's admins and badge issuer.
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
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [relayUrl]);

  // The single home subscription. Same deep-link foreground settle pattern as
  // src/orders/useOrders.ts.
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
        const anchor = parseCommunityAnchor(event);
        // Only the relay's own root key may declare the community admins.
        if (!anchor || anchor.pubkey.toLowerCase() !== rootPubkey.toLowerCase()) return;
        setBuffer((current) => {
          if (current.anchor && !isNewerAnchor(anchor, current.anchor)) return current;
          return { ...current, anchor };
        });
        return;
      }

      if (kind === KIND_AWARD) {
        const id = event.id() ?? "";
        const issuerPubkey = (event.pubkey() ?? "").toLowerCase();
        const definitionAddress = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        if (!id || !issuerPubkey || !definitionAddress || !holderPubkey) return;
        const expiration = Number(extractTagValue(event, "expiration"));
        const orderRef = deriveOrderRef({
          awardId: id,
          order: extractTagValue(event, "order") ?? undefined,
          i: extractTagValue(event, "i") ?? undefined,
        });
        const award: HomeAwardInput = {
          id,
          issuerPubkey,
          definitionAddress,
          holderPubkey,
          orderContextKey: orderContextKey(orderRef),
          createdAt: event.createdAt(),
          ...(Number.isSafeInteger(expiration) && expiration > 0 ? { expiresAt: expiration } : {}),
        };
        setBuffer((current) => ({ ...current, awards: new Map(current.awards).set(id, award) }));
        return;
      }

      if (kind === KIND_BADGE_DEFINITION || kind === KIND_LISTING) {
        const d = extractTagValue(event, "d");
        const author = (event.pubkey() ?? "").toLowerCase();
        const id = event.id() ?? "";
        if (!d || !author || !id) return;
        const address = `${kind}:${author}:${d}`;
        const createdAt = event.createdAt();
        // NIP-97 grammar: 30402 listings name via `title`, 30009 badge
        // definitions via `name`; classification derives from the shape.
        const name = kind === KIND_LISTING ? extractTagValue(event, "title") : extractTagValue(event, "name");
        const type = entitlementTypeFor(kind, event);
        const availability = extractTagValue(event, "availability");
        const definition: HomeDefinitionInput = {
          address,
          id,
          authorPubkey: author,
          createdAt,
          ...(name ? { name } : {}),
          ...(type ? { type } : {}),
          sellable: isSellableDefinition(event),
          ...(type === "role" ? { permissions: parsePermissionTags(event) } : {}),
          ...(availability ? { availability } : {}),
        };
        setBuffer((current) => {
          // Addressable definitions resolve as the latest per address.
          const previous = current.definitions.get(address);
          if (
            previous &&
            (previous.createdAt > createdAt || (previous.createdAt === createdAt && previous.id > id))
          ) {
            return current;
          }
          return { ...current, definitions: new Map(current.definitions).set(address, definition) };
        });
        return;
      }

      if (kind === KIND_STATUS) {
        const id = event.id() ?? "";
        const signerPubkey = (event.pubkey() ?? "").toLowerCase();
        const status = extractTagValue(event, "status");
        const awardId = (extractTagValue(event, "e") ?? "").toLowerCase();
        const definitionAddress = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        // NIP-97: `d` must equal the single order/event context tag prefixed
        // with its name; statuses failing this are dropped.
        const context = parseStatusContext({
          order: extractTagValue(event, "order") ?? undefined,
          event: extractTagValue(event, "event") ?? undefined,
          d: extractTagValue(event, "d") ?? undefined,
        });
        if (
          !id ||
          !signerPubkey ||
          !awardId ||
          !definitionAddress ||
          !holderPubkey ||
          !status ||
          !context
        ) {
          return;
        }
        if (!PUBLISHED_STATUSES.has(status)) return;
        const entry: HomeStatusInput = {
          id,
          signerPubkey,
          awardId,
          definitionAddress,
          holderPubkey,
          contextKey: context.key,
          contextType: context.type,
          status: status as PublishedOrderStatus,
          createdAt: event.createdAt(),
        };
        setBuffer((current) => ({ ...current, statuses: new Map(current.statuses).set(id, entry) }));
        return;
      }

      if (kind === KIND_CALENDAR_EVENT) {
        const id = event.id() ?? "";
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        const d = extractTagValue(event, "d") ?? "";
        const startsAt = Number(extractTagValue(event, "start"));
        if (!id || !authorPubkey || !d || !Number.isSafeInteger(startsAt) || startsAt <= 0) return;
        const title = extractTagValue(event, "title") ?? extractTagValue(event, "name");
        const endsAt = Number(extractTagValue(event, "end"));
        const calendarEvent: HomeCalendarEventInput = {
          id,
          authorPubkey,
          d,
          ...(title ? { title } : {}),
          startsAt,
          ...(Number.isSafeInteger(endsAt) && endsAt > 0 ? { endsAt } : {}),
          createdAt: event.createdAt(),
        };
        setBuffer((current) => ({
          ...current,
          calendarEvents: new Map(current.calendarEvents).set(id, calendarEvent),
        }));
        return;
      }

      if (kind === KIND_REVOCATION) {
        const id = event.id() ?? "";
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        const references = extractTagValues(event, "e");
        if (!id || !authorPubkey || references.length === 0) return;
        setBuffer((current) => ({
          ...current,
          deletions: new Map(current.deletions).set(id, {
            id,
            authorPubkey,
            references,
            createdAt: event.createdAt(),
          }),
        }));
        return;
      }

      if (kind === KIND_VENUE_PROFILE) {
        const id = event.id() ?? "";
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        const d = extractTagValue(event, "d") ?? "";
        if (!id || !authorPubkey || !d) return;
        const name = extractTagValue(event, "name");
        const profile: HomeProfileInput = {
          id,
          authorPubkey,
          d,
          ...(name ? { name } : {}),
          createdAt: event.createdAt(),
        };
        setBuffer((current) => ({ ...current, profiles: new Map(current.profiles).set(id, profile) }));
      }
    };

    const startAfterForegroundSettles = () => {
      stop();
      subscribeTimer = setTimeout(() => {
        subscribeTimer = null;
        const subId = `board_home_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [{ kinds: HOME_KINDS, relays: [relayUrl], limit: 500, noCache: true }],
          handleMessage,
          { closeOnEose: false },
        );
        subscribed = true;
        // EOSE is the authoritative loaded signal; this fallback keeps the
        // screen honest when a relay never answers.
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

  // Ticker so oldest-wait and expiring-soon stay current.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  const trust = useMemo(() => (buffer.anchor ? trustFromAnchor(buffer.anchor) : null), [buffer.anchor]);

  const summary = useMemo<HomeSummary | null>(() => {
    if (!trust) return null;
    return projectHomeSummary({
      profiles: [...buffer.profiles.values()],
      definitions: [...buffer.definitions.values()],
      awards: [...buffer.awards.values()],
      statuses: [...buffer.statuses.values()],
      calendarEvents: [...buffer.calendarEvents.values()],
      deletions: [...buffer.deletions.values()],
      trust,
      now,
    });
  }, [trust, buffer, now]);

  const live = Boolean(relayUrl && trust && !error);

  // Fixed QA contract: one projection marker per summary change.
  useEffect(() => {
    if (!__DEV__ || !summary || !relayUrl || !loaded) return;
    console.log(`[crays-board-home]${JSON.stringify(homeMarkerPayload(summary, relayUrl, live))}`);
  }, [summary, relayUrl, loaded, live]);

  if (restoring) return { status: "loading", live: false, summary: null };
  if (error) return { status: "error", live: false, summary: null, error };
  if (!venue) return { status: "ready", live: false, summary: null };
  if (!loaded || !trust || !summary) return { status: "loading", live, summary: null };
  return { status: "ready", live, summary };
}
