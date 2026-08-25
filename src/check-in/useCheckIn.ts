import { extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import {
  definitionAddress,
  entitlementTypeFor,
  isNewerAnchor,
  isSellableDefinition,
  maxUsesForDefinition,
  parseCommunityAnchor,
  parsePermissionTags,
  parseStatusContext,
  type CommunityAnchor,
} from "@/access/nip97";
import {
  definitionAuthorTrusted,
  fetchRelayRootPubkey,
  trustFromAnchor,
  trustWithFulfillmentRoles,
  type FulfillmentRoleDefinition,
  type CommunityTrust,
} from "@/access/trust";
import { getNostrRuntime } from "@/nostr/manager";
import {
  KIND_ANCHOR,
  KIND_AWARD,
  KIND_BADGE_DEFINITION,
  KIND_LISTING,
  KIND_STATUS,
  type PublishedOrderStatus,
} from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";

import {
  expectedEventAwards,
  projectCheckIn,
  selectActiveEvent,
  type CalendarEventRecord,
  type CheckInAwardRecord,
  type TicketDefinitionRecord,
} from "./fold";
import {
  KIND_CALENDAR_EVENT,
  KIND_DELETION,
  type CheckInAward,
  type CheckInRevocation,
  type CheckInStatus,
} from "./presentation";

export type CheckInResult = {
  status: "loading" | "ready" | "error";
  event?: CalendarEventRecord;
  expected: number;
  checkedIn: number;
  error?: string;
  /** Relay-truth inputs for presentation validation at submit time. */
  awards: CheckInAward[];
  statuses: CheckInStatus[];
  revocations: CheckInRevocation[];
  trust: CommunityTrust | null;
};

type Buffer = {
  /** Current community anchor (root-signed; latest wins). */
  anchor: CommunityAnchor | null;
  events: Map<string, CalendarEventRecord>;
  awards: Map<string, CheckInAwardRecord>;
  definitions: Map<string, TicketDefinitionRecord>;
  roleDefinitions: Map<string, FulfillmentRoleDefinition>;
  statuses: Map<string, CheckInStatus>;
  revocations: Map<string, CheckInRevocation>;
};

const emptyBuffer = (): Buffer => ({
  anchor: null,
  events: new Map(),
  awards: new Map(),
  definitions: new Map(),
  roleDefinitions: new Map(),
  statuses: new Map(),
  revocations: new Map(),
});

const READY: Omit<CheckInResult, "status"> = {
  expected: 0,
  checkedIn: 0,
  awards: [],
  statuses: [],
  revocations: [],
  trust: null,
};

const FULFILLMENT_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "processing",
  "ready",
  "fulfilled",
  "cancelled",
]);

/**
 * Subscription coordinator for the active venue relay. Trust bootstraps from
 * the relay's NIP-11 root key; the subscription then fetches the root-signed
 * community anchor and all entitlement state in one filter (kinds
 * 31923/8/30009/30402/37237/5/31727), extracts plain inputs at the worker
 * boundary, resolves delegated 37237/write role holders, and folds them
 * through the pure projection in fold.ts. EOSE is the loaded
 * signal. Cleanup unsubscribes on unmount, venue change, and backgrounding.
 */
export function useCheckIn(): CheckInResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;

  const [rootPubkey, setRootPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Trust bootstrap (NIP-97 Verification): the only out-of-band fact is the
  // community root key from the relay's NIP-11 document.
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

  // The single check-in subscription, gated on the root key (the anchor check
  // in handleMessage needs it). Same deep-link foreground settle window as
  // useOrders (nipworker replaces live sockets during the wake).
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
        // Only the root-signed anchor carries authority; latest version wins.
        const anchor = parseCommunityAnchor(event);
        if (!anchor || anchor.pubkey !== rootPubkey) return;
        setBuffer((current) =>
          current.anchor && !isNewerAnchor(anchor, current.anchor) ? current : { ...current, anchor },
        );
        return;
      }

      if (kind === KIND_CALENDAR_EVENT) {
        const author = (event.pubkey() ?? "").toLowerCase();
        const d = extractTagValue(event, "d");
        if (!author || !d) return;
        const address = definitionAddress(KIND_CALENDAR_EVENT, author, d);
        const title = extractTagValue(event, "title");
        const start = Number(extractTagValue(event, "start"));
        const record: CalendarEventRecord = {
          address,
          authorPubkey: author,
          createdAt: event.createdAt(),
          ...(title ? { title } : {}),
          ...(Number.isSafeInteger(start) && start > 0 ? { start } : {}),
        };
        setBuffer((current) => {
          const existing = current.events.get(address);
          if (existing && existing.createdAt >= record.createdAt) return current;
          return { ...current, events: new Map(current.events).set(address, record) };
        });
        return;
      }

      if (kind === KIND_AWARD) {
        const id = event.id() ?? "";
        const issuerPubkey = (event.pubkey() ?? "").toLowerCase();
        const awardDefinition = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        if (!id || !issuerPubkey || !awardDefinition || !holderPubkey) return;
        const expiration = Number(extractTagValue(event, "expiration"));
        const award: CheckInAwardRecord = {
          id,
          issuerPubkey,
          definitionAddress: awardDefinition,
          holderPubkey,
          createdAt: event.createdAt(),
          ...(Number.isSafeInteger(expiration) && expiration > 0 ? { expiresAt: expiration } : {}),
        };
        setBuffer((current) => ({ ...current, awards: new Map(current.awards).set(id, award) }));
        return;
      }

      if (kind === KIND_LISTING) {
        const d = extractTagValue(event, "d");
        const author = (event.pubkey() ?? "").toLowerCase();
        if (!d || !author) return;
        // Ticket definitions only: a 30402 linked to a calendar event
        // (`a` tag) is a NIP-97 event_access entitlement.
        if (entitlementTypeFor(KIND_LISTING, event) !== "event_access") return;
        const eventAddress = extractTagValue(event, "a") ?? "";
        const address = definitionAddress(KIND_LISTING, author, d);
        const record: TicketDefinitionRecord = {
          address,
          authorPubkey: author,
          eventAddress,
          sellable: isSellableDefinition(event),
          maxUses: maxUsesForDefinition(KIND_LISTING, event) ?? 1,
          createdAt: event.createdAt(),
        };
        setBuffer((current) => {
          const existing = current.definitions.get(address);
          if (existing && existing.createdAt >= record.createdAt) return current;
          return { ...current, definitions: new Map(current.definitions).set(address, record) };
        });
        return;
      }

      if (kind === KIND_BADGE_DEFINITION) {
        if (entitlementTypeFor(KIND_BADGE_DEFINITION, event) !== "role") return;
        const d = extractTagValue(event, "d");
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        const id = event.id() ?? "";
        if (!d || !authorPubkey || !id) return;
        const address = definitionAddress(KIND_BADGE_DEFINITION, authorPubkey, d);
        const definition: FulfillmentRoleDefinition = {
          address,
          id,
          authorPubkey,
          permissions: parsePermissionTags(event),
          sellable: isSellableDefinition(event),
          createdAt: event.createdAt(),
        };
        setBuffer((current) => {
          const previous = current.roleDefinitions.get(address);
          if (
            previous &&
            (previous.createdAt > definition.createdAt ||
              (previous.createdAt === definition.createdAt && previous.id > definition.id))
          ) {
            return current;
          }
          return {
            ...current,
            roleDefinitions: new Map(current.roleDefinitions).set(address, definition),
          };
        });
        return;
      }

      if (kind === KIND_STATUS) {
        const id = event.id() ?? "";
        const signerPubkey = (event.pubkey() ?? "").toLowerCase();
        const awardId = (extractTagValue(event, "e") ?? "").toLowerCase();
        const definitionAddress = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        const status = extractTagValue(event, "status");
        // NIP-97 context grammar: exactly one of order/event, d must match;
        // statuses failing this are ignored.
        const statusContext = parseStatusContext({
          order: extractTagValue(event, "order") || undefined,
          event: extractTagValue(event, "event") || undefined,
          d: extractTagValue(event, "d") || undefined,
        });
        if (
          !id ||
          !signerPubkey ||
          !awardId ||
          !definitionAddress ||
          !holderPubkey ||
          !status ||
          !FULFILLMENT_STATUSES.has(status) ||
          !statusContext
        ) {
          return;
        }
        const entry: CheckInStatus = {
          id,
          awardId,
          definitionAddress,
          holderPubkey,
          signerPubkey,
          contextKey: statusContext.key,
          status: status as PublishedOrderStatus,
          createdAt: event.createdAt(),
        };
        setBuffer((current) => ({ ...current, statuses: new Map(current.statuses).set(id, entry) }));
        return;
      }

      if (kind === KIND_DELETION) {
        const id = event.id() ?? "";
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        const references = extractTagValues(event, "e");
        if (!id || !authorPubkey || references.length === 0) return;
        setBuffer((current) => ({
          ...current,
          revocations: new Map(current.revocations).set(id, { authorPubkey, references }),
        }));
      }
    };

    const startAfterForegroundSettles = () => {
      stop();
      subscribeTimer = setTimeout(() => {
        subscribeTimer = null;
        const subId = `board_checkin_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [
            {
              kinds: [
                KIND_CALENDAR_EVENT,
                KIND_AWARD,
                KIND_BADGE_DEFINITION,
                KIND_LISTING,
                KIND_STATUS,
                KIND_DELETION,
                KIND_ANCHOR,
              ],
              relays: [relayUrl],
              limit: 500,
              noCache: true,
            },
          ],
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

  // Refresh the relative clock so event selection and award expiry stay live.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  // Trust derives from the root-signed anchor; nothing counts before it lands.
  const trust = useMemo<CommunityTrust | null>(() => {
    if (!buffer.anchor) return null;
    return trustWithFulfillmentRoles(trustFromAnchor(buffer.anchor), {
      definitions: [...buffer.roleDefinitions.values()],
      awards: [...buffer.awards.values()],
      revocations: [...buffer.revocations.values()],
      now,
    });
  }, [buffer.anchor, buffer.roleDefinitions, buffer.awards, buffer.revocations, now]);

  const projection = useMemo(() => {
    if (!trust) return { event: undefined, expected: 0, checkedIn: 0 };
    // Calendar events count only from trusted definition authors.
    const authored = [...buffer.events.values()].filter((event) =>
      definitionAuthorTrusted(event.authorPubkey, trust),
    );
    const event = selectActiveEvent(authored, now);
    if (!event) return { event: undefined, expected: 0, checkedIn: 0 };
    const { expected, checkedIn } = projectCheckIn({
      event,
      awards: [...buffer.awards.values()],
      definitions: buffer.definitions,
      statuses: [...buffer.statuses.values()],
      revocations: [...buffer.revocations.values()],
      trust,
      now,
    });
    return { event, expected, checkedIn };
  }, [trust, buffer, now]);

  // Fixed QA contract: one projection marker per refresh.
  useEffect(() => {
    if (!__DEV__ || !projection.event) return;
    console.log(
      `[crays-board-check-in]${JSON.stringify({
        event: projection.event.address,
        expected: projection.expected,
        checkedIn: projection.checkedIn,
      })}`,
    );
  }, [projection]);

  // Expected attendees for the active event, resolved for validation.
  const awards = useMemo<CheckInAward[]>(() => {
    if (!trust || !projection.event) return [];
    return expectedEventAwards({
      event: projection.event,
      awards: [...buffer.awards.values()],
      definitions: buffer.definitions,
      revocations: [...buffer.revocations.values()],
      trust,
      now,
    });
  }, [trust, projection.event, buffer, now]);
  const statuses = useMemo<CheckInStatus[]>(() => [...buffer.statuses.values()], [buffer]);
  const revocations = useMemo<CheckInRevocation[]>(() => [...buffer.revocations.values()], [buffer]);

  if (restoring) return { status: "loading", ...READY };
  if (error) return { status: "error", ...READY, error };
  if (!venue) return { status: "ready", ...READY };
  if (!loaded || !trust) return { status: "loading", ...READY };
  return {
    status: "ready",
    ...(projection.event ? { event: projection.event } : {}),
    expected: projection.expected,
    checkedIn: projection.checkedIn,
    awards,
    statuses,
    revocations,
    trust,
  };
}
