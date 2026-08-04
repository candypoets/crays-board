import { extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getNostrRuntime } from "@/nostr/manager";
import {
  KIND_AWARD,
  KIND_DEFINITION,
  KIND_STATUS,
  KIND_VENUE_PROFILE,
  type OrderContext,
  type PublishedOrderStatus,
} from "@/nostr/protocol";
import {
  projectOrders,
  type AwardInput,
  type DefinitionInput,
  type StatusInput,
} from "@/orders/fold";
import { useVenue } from "@/venue/VenueContext";
import { fetchVenueTrust } from "@/venue/trust";

import {
  homeMarkerPayload,
  projectHomeSummary,
  KIND_CALENDAR_EVENT,
  KIND_DELETION,
  type HomeCalendarEventInput,
  type HomeDefinitionInput,
  type HomeProfileInput,
  type HomeSummary,
} from "./summary";

export type HomeResult = {
  status: "loading" | "ready" | "error";
  /** Live = venue trust resolved and the relay subscription is open. */
  live: boolean;
  summary: HomeSummary | null;
  error?: string;
};

type HomeDefinition = DefinitionInput & HomeDefinitionInput;

type Buffer = {
  awards: Map<string, AwardInput>;
  definitions: Map<string, HomeDefinition>;
  statuses: Map<string, StatusInput>;
  calendarEvents: Map<string, HomeCalendarEventInput>;
  deletions: Map<string, { id: string; authorPubkey: string; references: string[]; createdAt: number }>;
  profiles: Map<string, HomeProfileInput>;
};

const emptyBuffer = (): Buffer => ({
  awards: new Map(),
  definitions: new Map(),
  statuses: new Map(),
  calendarEvents: new Map(),
  deletions: new Map(),
  profiles: new Map(),
});

const HOME_KINDS = [KIND_AWARD, KIND_DEFINITION, KIND_STATUS, KIND_VENUE_PROFILE, KIND_CALENDAR_EVENT, KIND_DELETION];

/**
 * Subscription coordinator for the Home attention summary (PRD §8.3). Owns
 * exactly one stable subscription (`board_home_<sanitized relay>`), extracts
 * plain inputs at the worker boundary, folds orders through the shared
 * src/orders projection, and derives the remaining counts through the pure
 * projection in summary.ts. EOSE is the loaded signal. Cleanup unsubscribes
 * on unmount, venue change, and backgrounding.
 */
export function useHomeSummary(): HomeResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;
  const serviceUrl = venue?.serviceUrl;

  const [trustedIssuers, setTrustedIssuers] = useState<ReadonlySet<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Issuer trust (venue-commerce-nip §4/§9): NIP-11 venue authorities plus the
  // badge issuer advertised by /community/info.
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

  // The single home subscription. Same deep-link foreground settle pattern as
  // src/orders/useOrders.ts.
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

      if (kind === KIND_AWARD) {
        const id = event.id() ?? "";
        const issuerPubkey = (event.pubkey() ?? "").toLowerCase();
        const definitionAddress = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        if (!id || !issuerPubkey || !definitionAddress || !holderPubkey) return;
        const expiration = Number(extractTagValue(event, "expiration"));
        const award: AwardInput = {
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
        const id = event.id() ?? "";
        if (!d || !author || !id) return;
        const address = `${KIND_DEFINITION}:${author}:${d}`;
        const createdAt = event.createdAt();
        const maxUses = Number(extractTagValue(event, "max_uses"));
        const name = extractTagValue(event, "name");
        const type = extractTagValue(event, "type");
        const availability = extractTagValue(event, "availability");
        const definition: HomeDefinition = {
          address,
          id,
          createdAt,
          ...(name ? { name } : {}),
          ...(type ? { type } : {}),
          sellable: extractTagValues(event, "t").includes("sellable"),
          ...(Number.isSafeInteger(maxUses) && maxUses > 0 ? { maxUses } : {}),
          ...(availability ? { availability } : {}),
        };
        setBuffer((current) => {
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
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        // §6.7 resolution: stage-scoped d (<awardId>:<status>); e is the stable
        // order/event context, so readers must group by e first.
        const contextKey = extractTagValue(event, "e") || extractTagValue(event, "d") || "";
        const status = extractTagValue(event, "status");
        const context = extractTagValue(event, "context");
        if (!id || !authorPubkey || !contextKey || !status) return;
        if (context !== "order" && context !== "event") return;
        const entry: StatusInput = {
          id,
          authorPubkey,
          contextKey,
          status: status as PublishedOrderStatus,
          context: context as OrderContext,
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

      if (kind === KIND_DELETION) {
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
  }, [relayUrl]);

  // Ticker so oldest-wait and expiring-soon stay current.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  const summary = useMemo<HomeSummary | null>(() => {
    if (!trustedIssuers) return null;
    const orders = projectOrders({
      awards: [...buffer.awards.values()],
      definitions: [...buffer.definitions.values()],
      statuses: [...buffer.statuses.values()],
      trustedIssuers,
      now,
    });
    return projectHomeSummary({
      orders,
      profiles: [...buffer.profiles.values()],
      definitions: [...buffer.definitions.values()],
      awards: [...buffer.awards.values()],
      calendarEvents: [...buffer.calendarEvents.values()],
      deletions: [...buffer.deletions.values()],
      trustedIssuers,
      now,
    });
  }, [trustedIssuers, buffer, now]);

  const live = Boolean(relayUrl && trustedIssuers && !error);

  // Fixed QA contract: one projection marker per summary change.
  useEffect(() => {
    if (!__DEV__ || !summary || !relayUrl || !loaded) return;
    console.log(`[crays-board-home]${JSON.stringify(homeMarkerPayload(summary, relayUrl, live))}`);
  }, [summary, relayUrl, loaded, live]);

  if (restoring) return { status: "loading", live: false, summary: null };
  if (error) return { status: "error", live: false, summary: null, error };
  if (!venue) return { status: "ready", live: false, summary: null };
  if (!loaded || !trustedIssuers || !summary) return { status: "loading", live, summary: null };
  return { status: "ready", live, summary };
}
