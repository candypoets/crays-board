import type { EventTemplate } from "nostr-tools";

import {
  eventContextKey,
  orderContextKey,
  type StatusContext,
} from "@/access/nip97";

/**
 * NIP-97 event contract for the Board (docs/architecture/venue-commerce-nip.md;
 * spec of record NIP-97, draft ~/nips/97.md).
 *
 * - Anchor (31727): root-signed community authorities; trust derives from it.
 * - Definitions (30009 roles/memberships, 30402 products/passes/tickets): what
 *   an award references; 31922/31923 calendar events are their own free-
 *   admission definitions.
 * - Award (8): the immutable purchase/grant fact; a trusted single-use award
 *   with no status event is implicitly `pending` — no creation event exists.
 * - Status (37237): one staff action against one award use, addressed by its
 *   fulfillment context (`order:<ref>` / `event:<coordinate>`); the only kind
 *   the Board writes on the order path.
 * - Venue profile (30078): the venue's public profile on its relay.
 */
export {
  ANCHOR_KIND as KIND_ANCHOR,
  AWARD_KIND as KIND_AWARD,
  BADGE_DEFINITION_KIND as KIND_BADGE_DEFINITION,
  CALENDAR_KINDS as KIND_CALENDAR_EVENTS,
  FULFILLMENT_KIND as KIND_STATUS,
  LISTING_KIND as KIND_LISTING,
  PRESENTATION_KIND as KIND_PRESENTATION,
  REVOCATION_KIND as KIND_REVOCATION,
} from "@/access/nip97";
export const KIND_VENUE_PROFILE = 30078;

/** Statuses that may be published. `pending` is never written (it is implicit). */
export type PublishedOrderStatus = "accepted" | "processing" | "ready" | "fulfilled" | "cancelled";

const PUBLISHED_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "processing",
  "ready",
  "fulfilled",
  "cancelled",
]);

const HEX_64 = /^[0-9a-f]{64}$/i;

function isHex64(value: string): boolean {
  return HEX_64.test(value);
}

function isAddressOfKind(value: string, kinds: readonly number[]): boolean {
  const [kind, author, ...d] = value.split(":");
  return kinds.includes(Number(kind)) && isHex64(author ?? "") && d.join(":").length > 0;
}

function isDefinitionAddress(value: string): boolean {
  return isAddressOfKind(value, [30009, 30402, 31922, 31923]);
}

function isEventCoordinate(value: string): boolean {
  return isAddressOfKind(value, [31922, 31923]);
}

/**
 * Publishers MUST keep created_at strictly monotonic per fulfillment context:
 * the current status is the latest by created_at (lowest id breaks ties), so
 * a rewrite in the same second must still win.
 */
export function nextStatusCreatedAt(
  latestStatusCreatedAt?: number,
  now: number = Math.floor(Date.now() / 1000),
): number {
  return latestStatusCreatedAt !== undefined && latestStatusCreatedAt >= now
    ? latestStatusCreatedAt + 1
    : now;
}

export type OrderStatusParams = {
  /** Award event id from the award being fulfilled (`e` tag). */
  awardId: string;
  /** Definition address from the award's `a` tag. */
  definitionAddress: string;
  /** Order holder pubkey from the award's `p` tag. */
  holderPubkey: string;
  status: PublishedOrderStatus;
  /**
   * Exactly one fulfillment context: the purchase's order ref (the award's
   * `order` tag, `i` minus its payment prefix, or the award id) or the
   * calendar event coordinate for admissions.
   */
  context: { type: "order"; orderRef: string } | { type: "event"; eventCoordinate: string };
  /** Latest retained created_at for this context, for monotonic rewrites. */
  latestStatusCreatedAt?: number;
};

/**
 * Builds the exact NIP-97 kind 37237 tag set: `status`, `a` = definition
 * address, `e` = award event id, `p` = holder, one `order`/`event` context
 * tag, and `d` = the same context prefixed with its name (so the latest
 * status per context survives addressable replacement). Content stays empty —
 * order content never lives on statuses.
 */
export function buildOrderStatus({
  awardId,
  definitionAddress,
  holderPubkey,
  status,
  context,
  latestStatusCreatedAt,
}: OrderStatusParams): EventTemplate {
  if (!isHex64(awardId)) throw new Error("The order context is not a valid award event id.");
  if (!isDefinitionAddress(definitionAddress)) {
    throw new Error("The order does not reference a valid definition address.");
  }
  if (!isHex64(holderPubkey)) throw new Error("The order holder is not a valid pubkey.");
  if (!PUBLISHED_STATUSES.has(status)) throw new Error(`Unknown order status: ${status}`);

  let statusContext: StatusContext;
  if (context.type === "order") {
    if (!context.orderRef) throw new Error("The order reference is empty.");
    statusContext = { type: "order", key: orderContextKey(context.orderRef), value: context.orderRef };
  } else if (context.type === "event") {
    if (!isEventCoordinate(context.eventCoordinate)) {
      throw new Error("The event context is not a valid calendar event coordinate.");
    }
    statusContext = { type: "event", key: eventContextKey(context.eventCoordinate), value: context.eventCoordinate };
  } else {
    throw new Error(`Unknown order context: ${(context as { type: string }).type}`);
  }

  return {
    kind: 37237,
    created_at: nextStatusCreatedAt(latestStatusCreatedAt),
    content: "",
    tags: [
      ["status", status],
      ["a", definitionAddress],
      ["e", awardId],
      ["p", holderPubkey],
      [statusContext.type, statusContext.value],
      ["d", statusContext.key],
    ],
  };
}
