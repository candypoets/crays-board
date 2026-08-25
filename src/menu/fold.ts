import { CALENDAR_KINDS, LISTING_KIND, definitionAddress } from "@/access/nip97";
import { definitionAuthorTrusted, type CommunityTrust } from "@/access/trust";

/**
 * Pure menu catalog projection per NIP-97 (spec of record ~/nips/97.md) on
 * the NIP-99 kind 30402 listing grammar. Everything here is synchronous and
 * fully unit-testable; the subscription coordinator in useMenu.ts only
 * extracts plain inputs from worker events and calls this fold.
 */

export type MenuAvailability = "available" | "unavailable" | "archived";

/** Section label for sellable products without a section tag. */
export const UNSECTIONED = "Other";

const PRODUCT_TYPES: ReadonlySet<string> = new Set(["food", "drink", "merchandise", "generic"]);
const AVAILABILITY: ReadonlySet<string> = new Set(["available", "unavailable", "archived"]);

export type MenuDefinitionInput = {
  id: string;
  /** Publishing key, lowercased — the only key allowed to edit this item. */
  author: string;
  d: string;
  /**
   * The NIP-99 price tag, validated by parsePriceTag at the worker boundary;
   * `amount` keeps the raw tag string for display. A listing without a
   * well-formed price is not sellable (NIP-97) and never appears.
   */
  price?: { amount: string; currency: string };
  title?: string;
  /** NIP-99 display text; readers accept `summary`, falling back to `description`. */
  summary?: string;
  description?: string;
  /** Product class from the `product_kind` tag; absent defaults to "generic". */
  productKind?: string;
  availability?: string;
  section?: string;
  position?: number;
  /**
   * Raw `a` tag value. A listing linked to a 31922/31923 calendar address is
   * a ticket and stays with its event — it is not a menu item.
   */
  a?: string;
  createdAt: number;
};

export type MenuItem = {
  /** `30402:<author>:<d>` addressable identity. */
  address: string;
  id: string;
  d: string;
  author: string;
  /** Product class: food, drink, merchandise, or generic. */
  type: string;
  name: string;
  description?: string;
  price: string;
  currency: string;
  availability: MenuAvailability;
  section?: string;
  position?: number;
  createdAt: number;
};

export type MenuSection = {
  name: string;
  items: MenuItem[];
};

export type MenuProjectionInput = {
  definitions: MenuDefinitionInput[];
  /** NIP-97 trust for the venue relay: anchor admins plus the root key. */
  trust: CommunityTrust;
};

function addressOf(input: MenuDefinitionInput): string {
  return definitionAddress(LISTING_KIND, input.author, input.d);
}

/** Addressable rule: latest by created_at; ties break by higher id. */
function latestDefinitions(definitions: MenuDefinitionInput[]): Map<string, MenuDefinitionInput> {
  const latest = new Map<string, MenuDefinitionInput>();
  for (const definition of definitions) {
    const address = addressOf(definition);
    const previous = latest.get(address);
    if (
      !previous ||
      definition.createdAt > previous.createdAt ||
      (definition.createdAt === previous.createdAt && definition.id > previous.id)
    ) {
      latest.set(address, definition);
    }
  }
  return latest;
}

/**
 * Projects the section-first sellable catalog. Untrusted authors, listings
 * without a well-formed price (the NIP-97 sellability rule), tickets linked
 * to a calendar event, unknown product kinds, and malformed listings never
 * appear. Definitions from other trusted keys DO appear — ownership only
 * controls editability (MENU-05), decided by the caller comparing
 * `item.author` with the active staff pubkey.
 *
 * Venue binding is owned by the caller: only events learned from the active
 * venue relay reach this fold.
 */
export function projectMenu({ definitions, trust }: MenuProjectionInput): MenuSection[] {
  const latest = latestDefinitions(definitions);
  const bySection = new Map<string, MenuItem[]>();

  for (const definition of latest.values()) {
    if (!definitionAuthorTrusted(definition.author, trust)) continue;
    const linkedKind = definition.a ? Number(definition.a.split(":")[0]) : undefined;
    if (linkedKind !== undefined && (CALENDAR_KINDS as readonly number[]).includes(linkedKind)) continue;
    if (!definition.price) continue;
    const type = definition.productKind ?? "generic";
    if (!PRODUCT_TYPES.has(type)) continue;
    const name = definition.title?.trim() ?? "";
    if (name.length < 2) continue;

    const availability = AVAILABILITY.has(definition.availability ?? "")
      ? (definition.availability as MenuAvailability)
      : "available";
    const sectionName = definition.section?.trim() ?? "";
    const description = definition.summary ?? definition.description ?? "";
    const item: MenuItem = {
      address: addressOf(definition),
      id: definition.id,
      d: definition.d,
      author: definition.author,
      type,
      name,
      ...(description ? { description } : {}),
      price: definition.price.amount,
      currency: definition.price.currency,
      availability,
      ...(sectionName ? { section: sectionName } : {}),
      ...(definition.position !== undefined ? { position: definition.position } : {}),
      createdAt: definition.createdAt,
    };
    const group = sectionName || UNSECTIONED;
    const list = bySection.get(group) ?? [];
    list.push(item);
    bySection.set(group, list);
  }

  const sections: MenuSection[] = [...bySection.entries()].map(([name, items]) => ({
    name,
    items: items.sort(
      // Deterministic position, ties break by d.
      (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.d.localeCompare(b.d),
    ),
  }));

  // Sections order by their earliest item position, then name; the
  // unsectioned group always sorts last.
  return sections.sort((a, b) => {
    if (a.name === UNSECTIONED) return 1;
    if (b.name === UNSECTIONED) return -1;
    const aPosition = a.items[0]?.position ?? Number.MAX_SAFE_INTEGER;
    const bPosition = b.items[0]?.position ?? Number.MAX_SAFE_INTEGER;
    return aPosition - bPosition || a.name.localeCompare(b.name);
  });
}

export type MenuFilters = {
  /** Case-insensitive match against name and description. */
  search?: string;
  /** Exact section name, or null for the whole catalog. */
  section?: string | null;
};

/** Search/section filters compose on top of the projected catalog (MENU-01). */
export function filterMenu(sections: MenuSection[], { search = "", section = null }: MenuFilters): MenuSection[] {
  const needle = search.trim().toLowerCase();
  return sections
    .filter((group) => section === null || group.name === section)
    .map((group) => ({
      name: group.name,
      items: needle
        ? group.items.filter(
            (item) =>
              item.name.toLowerCase().includes(needle) ||
              (item.description ?? "").toLowerCase().includes(needle),
          )
        : group.items,
    }))
    .filter((group) => group.items.length > 0);
}
