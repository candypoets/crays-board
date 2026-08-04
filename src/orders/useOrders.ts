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
  type OrderContext,
  type PublishedOrderStatus,
} from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";
import { fetchVenueTrust } from "@/venue/trust";

import {
  projectOrders,
  type AwardInput,
  type BoardOrder,
  type DefinitionInput,
  type StatusInput,
} from "./fold";

export type OrdersResult = {
  status: "loading" | "ready" | "error";
  orders: BoardOrder[];
  error?: string;
};

type Buffer = {
  awards: Map<string, AwardInput>;
  definitions: Map<string, DefinitionInput>;
  statuses: Map<string, StatusInput>;
};

const emptyBuffer = (): Buffer => ({
  awards: new Map(),
  definitions: new Map(),
  statuses: new Map(),
});

/**
 * Subscription coordinator for the active venue relay. Owns exactly one
 * stable subscription (`board_orders_<sanitized relay>`, kinds 8/30009/37237),
 * extracts plain inputs at the worker boundary, and folds them through the
 * pure projection in fold.ts. EOSE is the loaded signal; a healthy relay with
 * no matching events still reaches ready. Cleanup unsubscribes on unmount,
 * venue change, and backgrounding.
 */
export function useOrders(): OrdersResult {
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

  // The single board subscription. A deep link foregrounds Android
  // immediately before this effect runs and nipworker replaces live sockets
  // during that wake, so the REQ opens after a small settle window (pattern
  // from crays-rn useRoomManifest).
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
        const definition: DefinitionInput = {
          address,
          id,
          createdAt,
          ...(name ? { name } : {}),
          ...(type ? { type } : {}),
          sellable: extractTagValues(event, "t").includes("sellable"),
          ...(Number.isSafeInteger(maxUses) && maxUses > 0 ? { maxUses } : {}),
        };
        setBuffer((current) => {
          // Addressable events resolve as the latest per address (§3.1).
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
        // §6.7 (resolved): `e` is the stable order context; `d` is
        // stage-scoped (`<awardId>:<status>`) so the addressable-range relay
        // retains every transition. Legacy d=e events resolve identically.
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
      }
    };

    const startAfterForegroundSettles = () => {
      stop();
      subscribeTimer = setTimeout(() => {
        subscribeTimer = null;
        const subId = `board_orders_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [{ kinds: [KIND_AWARD, KIND_DEFINITION, KIND_STATUS], relays: [relayUrl], limit: 500, noCache: true }],
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

  // Elapsed-time ticker for visible cards.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  const orders = useMemo(() => {
    if (!trustedIssuers) return [];
    return projectOrders({
      awards: [...buffer.awards.values()],
      definitions: [...buffer.definitions.values()],
      statuses: [...buffer.statuses.values()],
      trustedIssuers,
      now,
    });
  }, [trustedIssuers, buffer, now]);

  // Fixed QA contract: one projection marker per visible order.
  useEffect(() => {
    if (!__DEV__) return;
    for (const order of orders) {
      console.log(
        `[crays-board-order]${JSON.stringify({ id: order.awardId, a: order.definitionAddress, status: order.status })}`,
      );
    }
  }, [orders]);

  if (restoring) return { status: "loading", orders: [] };
  if (error) return { status: "error", orders: [], error };
  if (!venue) return { status: "ready", orders: [] };
  if (!loaded || !trustedIssuers) return { status: "loading", orders: [] };
  return { status: "ready", orders };
}
