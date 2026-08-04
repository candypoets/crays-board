import { extractTagValue, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getNostrRuntime } from "@/nostr/manager";
import { useVenue } from "@/venue/VenueContext";
import { fetchVenueTrust } from "@/venue/trust";

import { projectEvents, type BoardEvent, type CalendarEventInput, type RsvpInput } from "./fold";
import { KIND_CALENDAR_EVENT, KIND_RSVP, RSVP_STATUSES, type RsvpStatus } from "./protocol";

export type EventsResult = {
  status: "loading" | "ready" | "error";
  events: BoardEvent[];
  error?: string;
};

type Buffer = {
  events: Map<string, CalendarEventInput>;
  rsvps: Map<string, RsvpInput>;
};

const emptyBuffer = (): Buffer => ({
  events: new Map(),
  rsvps: new Map(),
});

/**
 * Subscription coordinator for the active venue relay. Owns exactly one
 * stable subscription (`board_events_<sanitized relay>`, kinds 31923/31925),
 * extracts plain inputs at the worker boundary, and folds them through the
 * pure projection in fold.ts. EOSE is the loaded signal; a healthy relay with
 * no matching events still reaches ready. Cleanup unsubscribes on unmount,
 * venue change, and backgrounding.
 */
export function useEvents(): EventsResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;
  const serviceUrl = venue?.serviceUrl;

  const [trustedIssuers, setTrustedIssuers] = useState<ReadonlySet<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Only venue authorities may author calendar events in this slice
  // (EVENT-08); guests still RSVP with their own keys.
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

  // The single board subscription (same foreground-settle pattern as
  // useOrders: a deep link foregrounds Android immediately before this effect
  // runs and nipworker replaces live sockets during that wake).
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
        const pubkey = (event.pubkey() ?? "").toLowerCase();
        const identifier = extractTagValue(event, "d") ?? "";
        if (!id || !pubkey || !identifier) return;
        const createdAt = event.createdAt();
        const start = Number(extractTagValue(event, "start"));
        const end = Number(extractTagValue(event, "end"));
        const capacity = Number(extractTagValue(event, "capacity"));
        const title = extractTagValue(event, "title");
        const summary = extractTagValue(event, "summary");
        const location = extractTagValue(event, "location");
        const image = extractTagValue(event, "image");
        const address = `${KIND_CALENDAR_EVENT}:${pubkey}:${identifier}`;
        const entry: CalendarEventInput = {
          id,
          pubkey,
          identifier,
          createdAt,
          ...(title ? { title } : {}),
          ...(summary ? { summary } : {}),
          ...(location ? { location } : {}),
          ...(image ? { image } : {}),
          ...(Number.isSafeInteger(start) && start > 0 ? { start } : {}),
          ...(Number.isSafeInteger(end) && end > 0 ? { end } : {}),
          ...(Number.isSafeInteger(capacity) && capacity > 0 ? { capacity } : {}),
        };
        setBuffer((current) => {
          // Addressable events resolve as the latest per address.
          const previous = current.events.get(address);
          if (
            previous &&
            (previous.createdAt > createdAt || (previous.createdAt === createdAt && previous.id > id))
          ) {
            return current;
          }
          return { ...current, events: new Map(current.events).set(address, entry) };
        });
        return;
      }

      if (kind === KIND_RSVP) {
        const id = event.id() ?? "";
        const attendeePubkey = (event.pubkey() ?? "").toLowerCase();
        const eventAddress = extractTagValue(event, "a") ?? "";
        const status = extractTagValue(event, "status");
        if (!id || !attendeePubkey || !eventAddress || !status || !RSVP_STATUSES.has(status)) return;
        const entry: RsvpInput = {
          id,
          attendeePubkey,
          eventAddress,
          status: status as RsvpStatus,
          createdAt: event.createdAt(),
        };
        setBuffer((current) => ({ ...current, rsvps: new Map(current.rsvps).set(id, entry) }));
      }
    };

    const startAfterForegroundSettles = () => {
      stop();
      subscribeTimer = setTimeout(() => {
        subscribeTimer = null;
        const subId = `board_events_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [{ kinds: [KIND_CALENDAR_EVENT, KIND_RSVP], relays: [relayUrl], limit: 500, noCache: true }],
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

  // Upcoming/past classification ticker (same pattern as useOrders).
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  const events = useMemo(() => {
    if (!trustedIssuers) return [];
    return projectEvents({
      events: [...buffer.events.values()],
      rsvps: [...buffer.rsvps.values()],
      trustedIssuers,
      now,
    });
  }, [trustedIssuers, buffer, now]);

  // Fixed QA contract: one projection marker per visible event, carrying the
  // RSVP totals so the verifier can compare them against relay truth.
  useEffect(() => {
    if (!__DEV__) return;
    for (const event of events) {
      console.log(
        `[crays-board-event]${JSON.stringify({
          a: event.address,
          title: event.title,
          accepted: event.rsvps.accepted,
          tentative: event.rsvps.tentative,
          declined: event.rsvps.declined,
        })}`,
      );
    }
  }, [events]);

  if (restoring) return { status: "loading", events: [] };
  if (error) return { status: "error", events: [], error };
  if (!venue) return { status: "ready", events: [] };
  if (!loaded || !trustedIssuers) return { status: "loading", events: [] };
  return { status: "ready", events };
}
