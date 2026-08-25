import type { EventTemplate } from "nostr-tools";

import { buildOrderStatus, type OrderStatusParams } from "@/nostr/protocol";

/**
 * Feature-local order-status builder for the purchase ladder. NIP-97
 * fulfillment is context-addressed: every transition of one order reuses the
 * same `d = order:<orderRef>`, so the relay retains the latest status per
 * (author, context) via addressable replacement — which also makes a retry
 * after a timeout replace itself instead of duplicating. Cross-author
 * conflicts resolve by created_at (then lowest id), so `created_at` must stay
 * monotonic per context (handled in protocol.ts).
 */
export function buildOrderTransitionStatus(
  params: Omit<OrderStatusParams, "context"> & { orderRef: string },
): EventTemplate {
  const { orderRef, ...rest } = params;
  return buildOrderStatus({ ...rest, context: { type: "order", orderRef } });
}
