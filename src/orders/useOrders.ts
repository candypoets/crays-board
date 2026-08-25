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
  LISTING_KIND,
  maxUsesForDefinition,
  parseCommunityAnchor,
  parsePermissionTags,
  parsePriceTag,
  parseStatusContext,
  type CommunityAnchor,
} from "@/access/nip97";
import {
  fetchRelayRootPubkey,
  trustFromAnchor,
  trustWithFulfillmentRoles,
  type CapabilityRevocation,
  type FulfillmentRoleDefinition,
} from "@/access/trust";
import { getNostrRuntime } from "@/nostr/manager";
import {
  KIND_ANCHOR,
  KIND_AWARD,
  KIND_BADGE_DEFINITION,
  KIND_LISTING,
  KIND_REVOCATION,
  KIND_STATUS,
  type PublishedOrderStatus,
} from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";

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
  /** Latest root-signed community anchor (trust root for the fold). */
  anchor?: CommunityAnchor;
  awards: Map<string, AwardInput>;
  definitions: Map<string, DefinitionInput>;
  roleDefinitions: Map<string, FulfillmentRoleDefinition>;
  revocations: Map<string, CapabilityRevocation>;
  statuses: Map<string, StatusInput>;
};

const emptyBuffer = (): Buffer => ({
  awards: new Map(),
  definitions: new Map(),
  roleDefinitions: new Map(),
  revocations: new Map(),
  statuses: new Map(),
});

/**
 * Subscription coordinator for the active venue relay. Owns exactly one
 * stable subscription (`board_orders_<sanitized relay>`, kinds
 * 5/8/30009/30402/37237/31727), extracts plain inputs at the worker boundary,
 * resolves delegated 37237/write role holders, and
 * folds them through the pure projection in fold.ts. EOSE is the loaded
 * signal; a healthy relay with no matching events still reaches ready.
 * Cleanup unsubscribes on unmount, venue change, and backgrounding.
 */
export function useOrders(): OrdersResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;

  const [rootPubkey, setRootPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Community root key (NIP-97 trust model): the relay's NIP-11 `pubkey` is
  // the only out-of-band trust fact; the root-signed anchor event carries the
  // admin set and the delegated badge issuer.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRootPubkey(null);
    setError(null);
    if (!relayUrl) return;
    let cancelled = false;
    fetchRelayRootPubkey(relayUrl)
      .then((pubkey) => {
        if (!cancelled) setRootPubkey(pubkey.toLowerCase());
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [relayUrl]);

  // The single board subscription. A deep link foregrounds Android
  // immediately before this effect runs and nipworker replaces live sockets
  // during that wake, so the REQ opens after a small settle window (pattern
  // from crays-rn useRoomManifest).
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
        if (__DEV__) console.log(`[crays-board-orders-eose]${JSON.stringify({ relay: relayUrl })}`);
        setLoaded(true);
        return;
      }
      const event = isParsedEvent(message);
      if (!event) return;
      const kind = event.kind();

      if (kind === KIND_ANCHOR) {
        const anchor = parseCommunityAnchor(event);
        // Only the relay-identified root key anchors this venue's trust.
        if (!anchor || anchor.pubkey !== rootPubkey) return;
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
        const award: AwardInput = {
          id,
          issuerPubkey,
          definitionAddress,
          holderPubkey,
          createdAt: event.createdAt(),
          ...(Number.isSafeInteger(expiration) && expiration > 0 ? { expiresAt: expiration } : {}),
          orderRef: deriveOrderRef({
            awardId: id,
            order: extractTagValue(event, "order"),
            i: extractTagValue(event, "i"),
          }),
        };
        setBuffer((current) => ({ ...current, awards: new Map(current.awards).set(id, award) }));
        return;
      }

      if (kind === KIND_LISTING) {
        const d = extractTagValue(event, "d");
        const author = (event.pubkey() ?? "").toLowerCase();
        const id = event.id() ?? "";
        if (!d || !author || !id) return;
        const address = `${KIND_LISTING}:${author}:${d}`;
        const createdAt = event.createdAt();
        const name = extractTagValue(event, "title");
        const maxUses = maxUsesForDefinition(LISTING_KIND, event);
        const definition: DefinitionInput = {
          address,
          id,
          createdAt,
          ...(name ? { name } : {}),
          sellable: Boolean(parsePriceTag(event)),
          ...(maxUses !== undefined ? { maxUses } : {}),
          eventLinked: entitlementTypeFor(LISTING_KIND, event) === "event_access",
        };
        setBuffer((current) => {
          // Addressable events resolve as the latest per address (created_at,
          // then higher id).
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

      if (kind === KIND_BADGE_DEFINITION) {
        if (entitlementTypeFor(KIND_BADGE_DEFINITION, event) !== "role") return;
        const d = extractTagValue(event, "d");
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        const id = event.id() ?? "";
        if (!d || !authorPubkey || !id) return;
        const address = `${KIND_BADGE_DEFINITION}:${authorPubkey}:${d}`;
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
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        // Statuses without a valid NIP-97 context (exactly one of order/event,
        // with `d` matching) are ignored outright.
        const context = parseStatusContext({
          order: extractTagValue(event, "order"),
          event: extractTagValue(event, "event"),
          d: extractTagValue(event, "d"),
        });
        const status = extractTagValue(event, "status");
        const awardId = extractTagValue(event, "e") ?? "";
        const definitionAddress = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        if (
          !id ||
          !authorPubkey ||
          !context ||
          !status ||
          !awardId ||
          !definitionAddress ||
          !holderPubkey
        ) {
          return;
        }
        const entry: StatusInput = {
          id,
          authorPubkey,
          contextKey: context.key,
          contextType: context.type,
          status: status as PublishedOrderStatus,
          awardId,
          definitionAddress,
          holderPubkey,
          createdAt: event.createdAt(),
        };
        if (__DEV__) {
          console.log(
            `[crays-board-order-received-status]${JSON.stringify({ id, e: awardId, status })}`,
          );
        }
        setBuffer((current) => ({ ...current, statuses: new Map(current.statuses).set(id, entry) }));
        return;
      }

      if (kind === KIND_REVOCATION) {
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
        const subId = `board_orders_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [
            {
              kinds: [
                KIND_AWARD,
                KIND_BADGE_DEFINITION,
                KIND_LISTING,
                KIND_STATUS,
                KIND_REVOCATION,
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

  // Elapsed-time ticker for visible cards.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  const trust = useMemo(() => {
    if (!buffer.anchor) return null;
    return trustWithFulfillmentRoles(trustFromAnchor(buffer.anchor), {
      definitions: [...buffer.roleDefinitions.values()],
      awards: [...buffer.awards.values()],
      revocations: [...buffer.revocations.values()],
      now,
    });
  }, [buffer.anchor, buffer.roleDefinitions, buffer.awards, buffer.revocations, now]);

  const orders = useMemo(() => {
    if (!trust) return [];
    return projectOrders({
      awards: [...buffer.awards.values()],
      definitions: [...buffer.definitions.values()],
      statuses: [...buffer.statuses.values()],
      revocations: [...buffer.revocations.values()],
      trust,
      now,
    });
  }, [trust, buffer, now]);

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
  if (!loaded || !trust) return { status: "loading", orders: [] };
  return { status: "ready", orders };
}
