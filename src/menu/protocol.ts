import type { EventTemplate } from "nostr-tools";

import { KIND_LISTING } from "@/nostr/protocol";

import type { MenuAvailability, MenuItem } from "./fold";

/**
 * Menu definition builders per NIP-97 (spec of record ~/nips/97.md) on top of
 * the NIP-99 classified listing grammar, kind 30402.
 *
 * Every sellable hospitality product is an addressable kind 30402 listing.
 * Editing any field — including availability, archive, and restore — reuses
 * the same `d` and resolves as the latest addressable event; a builder never
 * mints a new `d` for an existing item. Only the original publishing key may
 * edit, enforced by the caller before a template is built.
 */

export type MenuDraft = {
  name: string;
  description: string;
  price: string;
  currency: string;
  section: string;
  availability: MenuAvailability;
};

export type MenuDraftField = "name" | "price" | "currency";
export type MenuDraftErrors = Partial<Record<MenuDraftField, string>>;

const PRICE_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const AVAILABILITY_VALUES: ReadonlySet<string> = new Set(["available", "unavailable", "archived"]);

/**
 * Client-side validation: name at least two characters, price a positive
 * decimal, currency a three-letter uppercase ISO-4217 code. Returns a map of
 * field errors; an empty map means the draft may be published.
 */
export function validateMenuDraft(draft: MenuDraft): MenuDraftErrors {
  const errors: MenuDraftErrors = {};
  if (draft.name.trim().length < 2) errors.name = "Enter a name of at least 2 characters.";
  const price = draft.price.trim();
  if (!PRICE_PATTERN.test(price) || Number(price) <= 0) {
    errors.price = "Enter a positive decimal price, e.g. 8.50.";
  }
  if (!CURRENCY_PATTERN.test(draft.currency.trim())) {
    errors.currency = "Enter a three-letter currency code, e.g. EUR.";
  }
  return errors;
}

export function isMenuDraftValid(errors: MenuDraftErrors): boolean {
  return Object.keys(errors).length === 0;
}

export type MenuDefinitionParams = {
  /** Stable addressable identifier — unchanged across every edit. */
  d: string;
  /** Product class: food, drink, merchandise, or generic. */
  type: string;
  draft: MenuDraft;
  /** Deterministic ordering inside the section; ties break by d. */
  position?: number;
};

/**
 * Builds the complete kind 30402 tag set for one product listing: `d`,
 * `title`, a single NIP-99 `price` tag (amount + currency), `availability`,
 * and `product_kind`, plus optional `section`, `position`, and `summary`.
 * Sellability is the well-formed price tag itself (NIP-97), and 30402
 * defaults to one use per award, so no sellable/max_uses markers exist.
 * Because addressable replacement swaps the whole event, the template always
 * carries the full intended tag set, not a diff. Throws on any validation
 * failure so an invalid draft can never reach the signer.
 */
export function buildMenuDefinition({ d, type, draft, position }: MenuDefinitionParams): EventTemplate {
  if (!d.trim()) throw new Error("The item is missing its stable identifier.");
  if (!type.trim()) throw new Error("The item is missing its product type.");
  if (!AVAILABILITY_VALUES.has(draft.availability)) {
    throw new Error(`Unknown availability: ${draft.availability}`);
  }
  const errors = validateMenuDraft(draft);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);

  const description = draft.description.trim();
  const section = draft.section.trim();
  const tags: string[][] = [
    ["d", d],
    ["title", draft.name.trim()],
    ["price", draft.price.trim(), draft.currency.trim()],
    ["availability", draft.availability],
    ["product_kind", type],
  ];
  if (section) tags.push(["section", section]);
  if (position !== undefined) tags.push(["position", String(position)]);
  if (description) tags.push(["summary", description]);

  return {
    kind: KIND_LISTING,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags,
  };
}

/**
 * Rebuilds an existing item's listing with a new draft — the addressable
 * update rule. The addressable identity (`d`, product kind, position) is
 * preserved from the relay projection; only the drafted fields change.
 */
export function buildMenuDefinitionUpdate(item: MenuItem, draft: MenuDraft): EventTemplate {
  return buildMenuDefinition({
    d: item.d,
    type: item.type,
    draft,
    ...(item.position !== undefined ? { position: item.position } : {}),
  });
}

/** Derives the editor draft from the confirmed relay projection of an item. */
export function draftFromItem(item: MenuItem): MenuDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    price: item.price,
    currency: item.currency,
    section: item.section ?? "",
    availability: item.availability,
  };
}
