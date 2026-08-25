import { extractTag, extractTagValue, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { isNewerAnchor, parseCommunityAnchor, parsePriceTag, type CommunityAnchor } from "@/access/nip97";
import { fetchRelayRootPubkey, trustFromAnchor } from "@/access/trust";
import { getNostrRuntime } from "@/nostr/manager";
import { KIND_ANCHOR, KIND_LISTING } from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";

import { projectMenu, type MenuDefinitionInput, type MenuSection } from "./fold";

export type MenuResult = {
  status: "loading" | "ready" | "error";
  sections: MenuSection[];
  error?: string;
};

type MenuBuffer = {
  /** Latest root-signed community anchor; trust derives from it. */
  anchor: CommunityAnchor | null;
};

/**
 * Subscription coordinator for the menu catalog on the active venue relay.
 * Owns exactly one stable subscription (`board_menu_<sanitized relay>`, kinds
 * 30402 listings + the 31727 community anchor), extracts plain definition
 * inputs at the worker boundary, and folds them through the pure projection
 * in fold.ts. Addressable replacement is resolved as latest-per-address at
 * extraction time; EOSE is the loaded signal. Cleanup unsubscribes on
 * unmount, venue change, and backgrounding.
 */
export function useMenu(): MenuResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;

  const [rootPubkey, setRootPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [definitions, setDefinitions] = useState<Map<string, MenuDefinitionInput>>(new Map());
  const [buffer, setBuffer] = useState<MenuBuffer>({ anchor: null });

  // NIP-97 trust bootstrap: the only out-of-band fact is the relay's NIP-11
  // root key; the root-signed anchor learned over the subscription declares
  // the admins whose listings may appear.
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

  // The single menu subscription. Opens after a small settle window because a
  // deep link foregrounds Android immediately before this effect runs and
  // nipworker replaces live sockets during that wake (pattern from
  // src/orders/useOrders.ts).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDefinitions(new Map());
    setBuffer({ anchor: null });
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

      if (event.kind() === KIND_ANCHOR) {
        const candidate = parseCommunityAnchor(event);
        // Only the relay's own root key may define venue authorities.
        if (!candidate || candidate.pubkey !== rootPubkey) return;
        setBuffer((current) => {
          if (current.anchor && !isNewerAnchor(candidate, current.anchor)) return current;
          return { ...current, anchor: candidate };
        });
        return;
      }

      if (event.kind() !== KIND_LISTING) return;
      const d = extractTagValue(event, "d");
      const author = (event.pubkey() ?? "").toLowerCase();
      const id = event.id() ?? "";
      if (!d || !author || !id) return;
      const address = `${KIND_LISTING}:${author}:${d}`;
      const createdAt = event.createdAt();

      const position = Number(extractTagValue(event, "position"));
      const parsedPrice = parsePriceTag(event);
      const definition: MenuDefinitionInput = {
        id,
        author,
        d,
        createdAt,
        ...(parsedPrice
          ? { price: { amount: extractTag(event, "price")?.[1] ?? String(parsedPrice.amount), currency: parsedPrice.currency } }
          : {}),
        ...(extractTagValue(event, "title") ? { title: extractTagValue(event, "title") } : {}),
        ...(extractTagValue(event, "summary") ? { summary: extractTagValue(event, "summary") } : {}),
        ...(extractTagValue(event, "description") ? { description: extractTagValue(event, "description") } : {}),
        ...(extractTagValue(event, "product_kind") ? { productKind: extractTagValue(event, "product_kind") } : {}),
        ...(extractTagValue(event, "availability") ? { availability: extractTagValue(event, "availability") } : {}),
        ...(extractTagValue(event, "section") ? { section: extractTagValue(event, "section") } : {}),
        ...(extractTagValue(event, "a") ? { a: extractTagValue(event, "a") } : {}),
        ...(Number.isSafeInteger(position) ? { position } : {}),
      };

      setDefinitions((current) => {
        // Addressable update rule: the latest event wins; ties break by
        // higher event id, so a replaced listing never flickers back.
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
          [{ kinds: [KIND_LISTING, KIND_ANCHOR], relays: [relayUrl], limit: 500, noCache: true }],
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

  const trust = useMemo(() => (buffer.anchor ? trustFromAnchor(buffer.anchor) : null), [buffer.anchor]);

  const sections = useMemo(() => {
    if (!trust) return [];
    return projectMenu({ definitions: [...definitions.values()], trust });
  }, [trust, definitions]);

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
  if (!loaded || !trust) return { status: "loading", sections: [] };
  return { status: "ready", sections };
}
