import type { EventTemplate } from "nostr-tools";

/**
 * NIP-VC event contract (docs/architecture/venue-commerce-nip.md).
 *
 * - Definition (30009): what the item is, addressable, staff-owned.
 * - Award (8): the immutable purchase/grant fact; a trusted single-use award
 *   with no status event is implicitly `pending` — no creation event exists.
 * - Status (37237): one staff action against one award; the only kind the
 *   Board writes on the order path.
 * - Venue profile (30078): the venue's public profile on its relay.
 */
export const KIND_DEFINITION = 30009;
export const KIND_AWARD = 8;
export const KIND_STATUS = 37237;
export const KIND_VENUE_PROFILE = 30078;

/** Statuses that may be published. `pending` is never written (§6.1). */
export type PublishedOrderStatus = "accepted" | "processing" | "ready" | "fulfilled" | "cancelled";
export type OrderContext = "order" | "event";

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

function isDefinitionAddress(value: string): boolean {
  const [kind, author, ...d] = value.split(":");
  return kind === String(KIND_DEFINITION) && isHex64(author ?? "") && d.join(":").length > 0;
}

export type OrderStatusParams = {
  /** Order context: the award event id (§1). */
  awardId: string;
  /** `30009:<definition-author>:<d>` address from the award's `a` tag. */
  definitionAddress: string;
  /** Order holder pubkey from the award's `p` tag. */
  holderPubkey: string;
  status: PublishedOrderStatus;
  context: OrderContext;
};

/**
 * Builds the exact kind 37237 tag set per venue-commerce-nip §6.1:
 * `d` = order context (award event id), `e` = award id, `a` = definition
 * address, `p` = holder, `status`, `context`. Content stays empty — order
 * content never lives on statuses.
 */
export function buildOrderStatus({
  awardId,
  definitionAddress,
  holderPubkey,
  status,
  context,
}: OrderStatusParams): EventTemplate {
  if (!isHex64(awardId)) throw new Error("The order context is not a valid award event id.");
  if (!isDefinitionAddress(definitionAddress)) {
    throw new Error("The order does not reference a valid definition address.");
  }
  if (!isHex64(holderPubkey)) throw new Error("The order holder is not a valid pubkey.");
  if (!PUBLISHED_STATUSES.has(status)) throw new Error(`Unknown order status: ${status}`);
  if (context !== "order" && context !== "event") throw new Error(`Unknown order context: ${context}`);

  return {
    kind: KIND_STATUS,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [
      ["d", awardId],
      ["e", awardId],
      ["a", definitionAddress],
      ["p", holderPubkey],
      ["status", status],
      ["context", context],
    ],
  };
}
