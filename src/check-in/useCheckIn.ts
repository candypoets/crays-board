import { extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getNostrRuntime } from "@/nostr/manager";
import { KIND_AWARD, KIND_DEFINITION, KIND_STATUS, type OrderContext, type PublishedOrderStatus } from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";
import { fetchVenueTrust } from "@/venue/trust";

import {
  projectCheckIn,
  selectActiveEvent,
  type CalendarEventRecord,
  type CheckInAwardRecord,
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
  trustedIssuers: ReadonlySet<string> | null;
};

type Buffer = {
  events: Map<string, CalendarEventRecord>;
  awards: Map<string, CheckInAwardRecord>;
  definitions: Map<string, { maxUses?: number }>;
  statuses: Map<string, CheckInStatus & { id: string }>;
  revocations: Map<string, CheckInRevocation>;
};

const emptyBuffer = (): Buffer => ({
  events: new Map(),
  awards: new Map(),
  definitions: new Map(),
  statuses: new Map(),
  revocations: new Map(),
});

const READY: Omit<CheckInResult, "status"> = {
  expected: 0,
  checkedIn: 0,
  awards: [],
  statuses: [],
  revocations: [],
  trustedIssuers: null,
};

/**
 * Subscription coordinator for the active venue relay. Owns exactly one
 * stable subscription (`board_checkin_<sanitized relay>`, kinds
 * 31923/8/30009/37237/5 in a single filter), extracts plain inputs at the
 * worker boundary, and folds them through the pure projection in fold.ts.
 * EOSE is the loaded signal. Cleanup unsubscribes on unmount, venue change,
 * and backgrounding.
 */
export function useCheckIn(): CheckInResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;
  const serviceUrl = venue?.serviceUrl;

  const [trustedIssuers, setTrustedIssuers] = useState<ReadonlySet<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Issuer trust (venue-commerce-nip §4): venue authorities from the relay's
  // NIP-11 document plus the badge issuer advertised by /community/info.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrustedIssuers(null);
    setError(null);
    if (!relayUrl || !serviceUrl) return;
    let cancelled = false;
    fetchVenueTrust(relayUrl, serviceUrl)
      .then((trust) => {
        if (!cancelled) setTrustedIssuers(trust.trustedIssuers);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [relayUrl, serviceUrl]);

  // The single check-in subscription. Same deep-link foreground settle window
  // as useOrders (nipworker replaces live sockets during the wake).
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

      if (kind === KIND_CALENDAR_EVENT) {
        const id = event.id() ?? "";
        const accessAddress = extractTagValue(event, "a") ?? "";
        if (!id || !accessAddress.startsWith(`${KIND_DEFINITION}:`)) return;
        const title = extractTagValue(event, "title");
        const start = Number(extractTagValue(event, "start"));
        const record: CalendarEventRecord = {
          id,
          accessAddress,
          createdAt: event.createdAt(),
          ...(title ? { title } : {}),
          ...(Number.isSafeInteger(start) && start > 0 ? { start } : {}),
        };
        setBuffer((current) => ({ ...current, events: new Map(current.events).set(id, record) }));
        return;
      }

      if (kind === KIND_AWARD) {
        const id = event.id() ?? "";
        const issuerPubkey = (event.pubkey() ?? "").toLowerCase();
        const definitionAddress = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        if (!id || !issuerPubkey || !definitionAddress || !holderPubkey) return;
        const expiration = Number(extractTagValue(event, "expiration"));
        const award: CheckInAwardRecord = {
          id,
          issuerPubkey,
          definitionAddress,
          holderPubkey,
          createdAt: event.createdAt(),
          ...(Number.isSafeInteger(expiration) && expiration > 0 ? { expiresAt: expiration } : {}),
        };
        setBuffer((current) => ({ ...current, awards: new Map(current.awards).set(id, award) }));
        return;
      }

      if (kind === KIND_DEFINITION) {
        const d = extractTagValue(event, "d");
        const author = (event.pubkey() ?? "").toLowerCase();
        if (!d || !author) return;
        const address = `${KIND_DEFINITION}:${author}:${d}`;
        const maxUses = Number(extractTagValue(event, "max_uses"));
        setBuffer((current) => ({
          ...current,
          definitions: new Map(current.definitions).set(address, {
            ...(Number.isSafeInteger(maxUses) && maxUses > 0 ? { maxUses } : {}),
          }),
        }));
        return;
      }

      if (kind === KIND_STATUS) {
        const id = event.id() ?? "";
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        // §6.7 resolution: readers group status context by e first (d may be
        // stage-scoped as <awardId>:<status>).
        const contextKey = extractTagValue(event, "e") || extractTagValue(event, "d") || "";
        const status = extractTagValue(event, "status");
        const context = extractTagValue(event, "context");
        if (!id || !authorPubkey || !contextKey || !status) return;
        if (context !== "order" && context !== "event") return;
        const entry: CheckInStatus & { id: string } = {
          id,
          authorPubkey,
          contextKey,
          status: status as PublishedOrderStatus,
          context: context as OrderContext,
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
              kinds: [KIND_CALENDAR_EVENT, KIND_AWARD, KIND_DEFINITION, KIND_STATUS, KIND_DELETION],
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
  }, [relayUrl]);

  // Refresh the relative clock so event selection and award expiry stay live.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  const projection = useMemo(() => {
    if (!trustedIssuers) return { event: undefined, expected: 0, checkedIn: 0 };
    const event = selectActiveEvent([...buffer.events.values()], now);
    if (!event) return { event: undefined, expected: 0, checkedIn: 0 };
    const { expected, checkedIn } = projectCheckIn({
      event,
      awards: [...buffer.awards.values()],
      statuses: [...buffer.statuses.values()],
      revocations: [...buffer.revocations.values()],
      trustedIssuers,
      now,
    });
    return { event, expected, checkedIn };
  }, [trustedIssuers, buffer, now]);

  // Fixed QA contract: one projection marker per refresh.
  useEffect(() => {
    if (!__DEV__ || !projection.event) return;
    console.log(
      `[crays-board-check-in]${JSON.stringify({
        event: projection.event.id,
        a: projection.event.accessAddress,
        expected: projection.expected,
        checkedIn: projection.checkedIn,
      })}`,
    );
  }, [projection]);

  const awards = useMemo<CheckInAward[]>(
    () =>
      [...buffer.awards.values()].map((award) => ({
        id: award.id,
        issuerPubkey: award.issuerPubkey,
        definitionAddress: award.definitionAddress,
        holderPubkey: award.holderPubkey,
        maxUses: buffer.definitions.get(award.definitionAddress)?.maxUses ?? 1,
      })),
    [buffer],
  );
  const statuses = useMemo<CheckInStatus[]>(() => [...buffer.statuses.values()], [buffer]);
  const revocations = useMemo<CheckInRevocation[]>(() => [...buffer.revocations.values()], [buffer]);

  if (restoring) return { status: "loading", ...READY };
  if (error) return { status: "error", ...READY, error };
  if (!venue) return { status: "ready", ...READY };
  if (!loaded || !trustedIssuers) return { status: "loading", ...READY };
  return {
    status: "ready",
    ...(projection.event ? { event: projection.event } : {}),
    expected: projection.expected,
    checkedIn: projection.checkedIn,
    awards,
    statuses,
    revocations,
    trustedIssuers,
  };
}
