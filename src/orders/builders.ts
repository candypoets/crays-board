import type { EventTemplate } from "nostr-tools";

import { buildOrderStatus, type OrderStatusParams } from "@/nostr/protocol";

/**
 * Feature-local order-status builder (venue-commerce-nip §6.7, resolved by
 * device evidence): kind 37237 sits in the NIP-01 addressable range, so the
 * relay retains only the latest event per (kind, pubkey, d). A constant
 * `d = awardId` collapses the whole §6.2 ladder to one retained status — the
 * four acknowledged publishes in the orders-ladder scenario left exactly one
 * event on strfry. `d` is therefore unique per transition
 * (`<awardId>:<status>`); `e` remains the stable order context that folds
 * and verifiers group by. Republishing the same stage reuses the same `d`,
 * so a retry after a timeout replaces itself instead of duplicating.
 *
 * Validation stays centralized in protocol.ts; this only rewrites the d tag.
 */
export function buildOrderTransitionStatus(params: OrderStatusParams): EventTemplate {
  const base = buildOrderStatus(params);
  return {
    ...base,
    tags: base.tags.map((tag) => (tag[0] === "d" ? ["d", `${params.awardId}:${params.status}`] : tag)),
  };
}
