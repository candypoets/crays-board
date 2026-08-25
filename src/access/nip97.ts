import {
  extractTag,
  extractTagValue,
  extractTagValues,
  readStringVec,
  type ParsedEvent,
  type TagCollectionLike,
  type TagLike,
} from "@candypoets/nipworker";

/**
 * NIP-97 primitives: the community anchor event, the kind-scoped `permission`
 * tag grammar, price/sellability, max-uses, and the fulfillment context
 * grammar. Spec of record: NIP-97 (draft, ~/nips/97.md). Mirrors crays-rn
 * src/access/nip97.ts; Board-specific helpers (order refs, status context
 * keys, classification) live at the bottom.
 */

export const ANCHOR_KIND = 31727;
export const ANCHOR_D = "community";

export const BADGE_DEFINITION_KIND = 30009;
export const LISTING_KIND = 30402;
export const CALENDAR_KINDS = [31922, 31923] as const;

export const AWARD_KIND = 8;
export const REVOCATION_KIND = 5;
export const PRESENTATION_KIND = 27236;
export const FULFILLMENT_KIND = 37237;

/** Definition kinds an award's `a` tag may reference. */
export const DEFINITION_KINDS = [30009, 30402, 31922, 31923] as const;

/** Named (non-numeric) capabilities for off-relay features. */
export const NAMED_CAPABILITIES = ["invites", "moderation", "settings"] as const;
export type NamedCapability = (typeof NAMED_CAPABILITIES)[number];

export type CommunityAnchor = {
  id: string;
  pubkey: string;
  admins: string[];
  badgeIssuer?: string;
  name: string;
  description: string;
  image?: string;
  createdAt: number;
};

/** Latest anchor wins: created_at, then lowest event id as tie-breaker. */
export function isNewerAnchor(candidate: CommunityAnchor, current: CommunityAnchor) {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt && candidate.id < current.id)
  );
}

export function parseCommunityAnchor(event: ParsedEvent): CommunityAnchor | undefined {
  if (event.kind() !== ANCHOR_KIND) return undefined;
  if (extractTagValue(event, "d") !== ANCHOR_D) return undefined;
  const pubkey = event.pubkey();
  if (!pubkey) return undefined;

  const admins = extractTagValues(event, "p").filter((admin) => Boolean(admin));
  if (!admins.length) return undefined;

  const badgeIssuer = extractTagValue(event, "badge_issuer");
  return {
    id: event.id() || "",
    pubkey,
    admins,
    badgeIssuer: badgeIssuer && /^[0-9a-f]{64}$/i.test(badgeIssuer) ? badgeIssuer : undefined,
    name: extractTagValue(event, "name") || "",
    description: extractTagValue(event, "description") || "",
    image: extractTagValue(event, "image") || undefined,
    createdAt: Number(event.createdAt()),
  };
}

export type PermissionAccess = "read" | "write";

export type Permission = {
  /** Raw 2nd tag element: a kind number as string, or a named capability. */
  capability: string;
  access?: PermissionAccess;
  topic?: string;
};

export function permissionKind(permission: Permission): number | undefined {
  if (!/^[0-9]+$/.test(permission.capability)) return undefined;
  const kind = Number(permission.capability);
  return Number.isSafeInteger(kind) && kind >= 0 && kind <= 65535 ? kind : undefined;
}

export function isNamedCapability(permission: Permission) {
  return permissionKind(permission) === undefined;
}

export function buildPermissionTag(permission: Permission): string[] {
  const tag = ["permission", permission.capability];
  if (permission.access) tag.push(permission.access);
  if (permission.topic) {
    // An empty 3rd element keeps the topic positional and means read+write.
    if (!permission.access) tag.push("");
    tag.push(permission.topic);
  }
  return tag;
}

export function parsePermissionTag(tag: string[]): Permission | undefined {
  if (tag[0] !== "permission" || !tag[1]) return undefined;
  const access = tag[2];
  return {
    capability: tag[1],
    access: access === "read" || access === "write" ? access : undefined,
    topic: tag[3] || undefined,
  };
}

function collectTags(source: TagCollectionLike): string[][] {
  if (Array.isArray(source)) return (source as readonly TagLike[]).map((tag) => readStringVec(tag));
  const collection = source as { tags(index: number): TagLike | null; tagsLength(): number };
  const tags: string[][] = [];
  for (let index = 0; index < collection.tagsLength(); index += 1) {
    const tag = collection.tags(index);
    if (tag) tags.push(readStringVec(tag));
  }
  return tags;
}

export function parsePermissionTags(source: TagCollectionLike): Permission[] {
  return collectTags(source)
    .map(parsePermissionTag)
    .filter((permission): permission is Permission => Boolean(permission));
}

/**
 * Does a permission grant the requested access on an event of `kind` (with
 * optional `t` topic)? A permission without an access marker grants both read
 * and write; a permission without a topic filter grants any topic.
 */
export function permissionGrants(
  permission: Permission,
  kind: number,
  access: PermissionAccess,
  topic?: string,
) {
  if (permissionKind(permission) !== kind) return false;
  if (permission.access && permission.access !== access) return false;
  if (permission.topic && permission.topic !== topic) return false;
  return true;
}

export function definitionAddress(kind: number, pubkey: string, d: string) {
  return `${kind}:${pubkey}:${d}`;
}

export function isDefinitionAddress(address: string) {
  const kind = Number(address.split(":")[0]);
  return (DEFINITION_KINDS as readonly number[]).includes(kind);
}

export type PriceTag = {
  amount: number;
  currency: string;
  recurrence?: string;
};

export function parsePriceTag(source: TagCollectionLike): PriceTag | undefined {
  const tag = extractTag(source, "price");
  const amount = Number(tag?.[1]);
  if (!tag?.[1] || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(tag[1]) || !Number.isFinite(amount)) {
    return undefined;
  }
  const currency = tag[2] || "";
  if (!/^[A-Z]{3}$/.test(currency)) return undefined;
  return { amount, currency, ...(tag[3] ? { recurrence: tag[3] } : {}) };
}

/**
 * NIP-97 sellability: the definition carries a well-formed `price` tag. Zero
 * price counts — the relay write gate and the issuance service treat any
 * priced definition as awardable by the delegated `badge_issuer` (free
 * memberships ride the same invite path as paid ones).
 */
export function isSellableDefinition(source: TagCollectionLike): boolean {
  return Boolean(parsePriceTag(source));
}

/** Uses per award: explicit `max_uses`, else one for 30402 listings, else unlimited. */
export function maxUsesForDefinition(kind: number, source: TagCollectionLike): number | undefined {
  const raw = Number(extractTagValue(source, "max_uses"));
  if (Number.isSafeInteger(raw) && raw > 0) return raw;
  return kind === LISTING_KIND ? 1 : undefined;
}

/* ------------------------------------------------------------------------ */
/* Board-specific helpers                                                    */
/* ------------------------------------------------------------------------ */

export type EntitlementType = "membership" | "role" | "product" | "pass" | "event_access";

/**
 * NIP-97 classification is derived from the definition itself, never from
 * award tags: 30009 splits by `t` topic, a 30402 with an `a` event link is a
 * ticket, a multi-use 30402 is a pass, anything else priced on 30402 is a
 * product.
 */
export function entitlementTypeFor(kind: number, source: TagCollectionLike): EntitlementType | undefined {
  if (kind === BADGE_DEFINITION_KIND) {
    const topics = extractTagValues(source, "t");
    if (topics.includes("membership")) return "membership";
    if (topics.includes("role")) return "role";
    return undefined;
  }
  if (kind === LISTING_KIND) {
    const linked = extractTagValue(source, "a");
    const linkedKind = linked ? Number(linked.split(":")[0]) : undefined;
    if (linked && (CALENDAR_KINDS as readonly number[]).includes(linkedKind ?? 0)) return "event_access";
    const maxUses = maxUsesForDefinition(kind, source);
    return maxUses !== undefined && maxUses > 1 ? "pass" : "product";
  }
  return undefined;
}

/**
 * Order reference for one purchase award: the explicit `order` tag, else the
 * `i` idempotency tag minus its payment prefix, else the award id (crays-rn
 * RoomData rule; both the spec's `payment:` and the deployed
 * `payment-redemption:` prefixes are stripped).
 */
export function deriveOrderRef({
  awardId,
  order,
  i,
}: {
  awardId: string;
  order?: string;
  i?: string;
}): string {
  if (order) return order;
  if (i?.startsWith("payment-redemption:")) return i.slice("payment-redemption:".length);
  if (i?.startsWith("payment:")) return i.slice("payment:".length);
  return awardId;
}

/** NIP-97 fulfillment context keys: `order:<order-ref>` or `event:<coordinate>`. */
export function orderContextKey(orderRef: string) {
  return `order:${orderRef}`;
}

export function eventContextKey(eventCoordinate: string) {
  return `event:${eventCoordinate}`;
}

export type StatusContext = {
  type: "order" | "event";
  /** The full `d`/context key, e.g. `order:CR-1` or `event:31923:<author>:<d>`. */
  key: string;
  /** The raw `order`/`event` tag value (order ref or event coordinate). */
  value: string;
};

/**
 * Parses and validates the NIP-97 status context: exactly one of `order` or
 * `event`, and `d` MUST equal the context tag value prefixed with its name.
 * Statuses failing this are ignored (nuts-cash notifications rule).
 */
export function parseStatusContext({
  order,
  event,
  d,
}: {
  order?: string;
  event?: string;
  d?: string;
}): StatusContext | undefined {
  if (Boolean(order) === Boolean(event)) return undefined;
  if (order) {
    const key = orderContextKey(order);
    if (d !== key) return undefined;
    return { type: "order", key, value: order };
  }
  const key = eventContextKey(event as string);
  if (d !== key) return undefined;
  return { type: "event", key, value: event as string };
}
