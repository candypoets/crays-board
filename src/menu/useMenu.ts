import { extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getNostrRuntime } from "@/nostr/manager";
import { KIND_DEFINITION } from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";
import { fetchVenueTrust } from "@/venue/trust";

import { projectMenu, type MenuDefinitionInput, type MenuSection } from "./fold";

export type MenuResult = {
  status: "loading" | "ready" | "error";
  sections: MenuSection[];
  error?: string;
};

/**
 * Subscription coordinator for the menu catalog on the active venue relay.
 * Owns exactly one stable subscription (`board_menu_<sanitized relay>`, kind
 * 30009 only), extracts plain definition inputs at the worker boundary, and
 * folds them through the pure projection in fold.ts. Addressable replacement
 * is resolved as latest-per-address at extraction time; EOSE is the loaded
 * signal. Cleanup unsubscribes on unmount, venue change, and backgrounding.
 */
export function useMenu(): MenuResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;
  const serviceUrl = venue?.serviceUrl;

  const [trustedAuthors, setTrustedAuthors] = useState<ReadonlySet<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [definitions, setDefinitions] = useState<Map<string, MenuDefinitionInput>>(new Map());

  // Author trust (venue-commerce-nip §1): venue authorities from the relay's
  // NIP-11 document plus the badge issuer advertised by /community/info.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrustedAuthors(null);
    setError(null);
    if (!relayUrl || !serviceUrl) return;
    let cancelled = false;
    fetchVenueTrust(relayUrl, serviceUrl)
      .then((trust) => {
        if (!cancelled) setTrustedAuthors(trust.trustedIssuers);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [relayUrl, serviceUrl]);

  // The single menu subscription. Opens after a small settle window because a
  // deep link foregrounds Android immediately before this effect runs and
  // nipworker replaces live sockets during that wake (pattern from
  // src/orders/useOrders.ts).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDefinitions(new Map());
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
      if (!event || event.kind() !== KIND_DEFINITION) return;
      const d = extractTagValue(event, "d");
      const author = (event.pubkey() ?? "").toLowerCase();
      const id = event.id() ?? "";
      if (!d || !author || !id) return;
      const address = `${KIND_DEFINITION}:${author}:${d}`;
      const createdAt = event.createdAt();

      const position = Number(extractTagValue(event, "position"));
      const maxUses = Number(extractTagValue(event, "max_uses"));
      const definition: MenuDefinitionInput = {
        id,
        author,
        d,
        createdAt,
        sellable: extractTagValues(event, "t").includes("sellable"),
        ...(extractTagValue(event, "type") ? { type: extractTagValue(event, "type") } : {}),
        ...(extractTagValue(event, "name") ? { name: extractTagValue(event, "name") } : {}),
        ...(extractTagValue(event, "description") ? { description: extractTagValue(event, "description") } : {}),
        ...(extractTagValue(event, "price") ? { price: extractTagValue(event, "price") } : {}),
        ...(extractTagValue(event, "currency") ? { currency: extractTagValue(event, "currency") } : {}),
        ...(extractTagValue(event, "availability") ? { availability: extractTagValue(event, "availability") } : {}),
        ...(extractTagValue(event, "section") ? { section: extractTagValue(event, "section") } : {}),
        ...(Number.isSafeInteger(position) ? { position } : {}),
        ...(Number.isSafeInteger(maxUses) && maxUses > 0 ? { maxUses } : {}),
      };

      setDefinitions((current) => {
        // §3.1 update rule: the latest addressable event wins; ties break by
        // higher event id, so a replaced definition never flickers back.
        const previous = current.get(address);
        if (
          previous &&
          (previous.createdAt > createdAt || (previous.createdAt === createdAt && previous.id > id))
        ) {
          return current;
        }
        return new Map(current).set(address, definition);
      });
    };

    const startAfterForegroundSettles = () => {
      stop();
      subscribeTimer = setTimeout(() => {
        subscribeTimer = null;
        const subId = `board_menu_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [{ kinds: [KIND_DEFINITION], relays: [relayUrl], limit: 500, noCache: true }],
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

  const sections = useMemo(() => {
    if (!trustedAuthors) return [];
    return projectMenu({ definitions: [...definitions.values()], trustedAuthors });
  }, [trustedAuthors, definitions]);

  // Fixed QA contract: one projection marker per visible item.
  useEffect(() => {
    if (!__DEV__) return;
    for (const section of sections) {
      for (const item of section.items) {
        console.log(
          `[crays-board-menu]${JSON.stringify({
            d: item.d,
            address: item.address,
            name: item.name,
            availability: item.availability,
          })}`,
        );
      }
    }
  }, [sections]);

  if (restoring) return { status: "loading", sections: [] };
  if (error) return { status: "error", sections: [], error };
  if (!venue) return { status: "ready", sections: [] };
  if (!loaded || !trustedAuthors) return { status: "loading", sections: [] };
  return { status: "ready", sections };
}
