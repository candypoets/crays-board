/**
 * Pure menu catalog projection per venue-commerce-nip §3 and PRD §8.5.
 * Everything here is synchronous and fully unit-testable; the subscription
 * coordinator in useMenu.ts only extracts plain inputs from worker events and
 * calls this fold.
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
  type?: string;
  name?: string;
  description?: string;
  price?: string;
  currency?: string;
  availability?: string;
  section?: string;
  position?: number;
  sellable: boolean;
  maxUses?: number;
  createdAt: number;
};

export type MenuItem = {
  /** `30009:<author>:<d>` addressable identity. */
  address: string;
  id: string;
  d: string;
  author: string;
  type: string;
  name: string;
  description?: string;
  price?: string;
  currency?: string;
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
  /** Venue authorities + advertised badge issuer (see venue/trust.ts). */
  trustedAuthors: ReadonlySet<string>;
};

function addressOf(input: MenuDefinitionInput): string {
  return `30009:${input.author}:${input.d}`;
}

/** Addressable rule (§3.1): latest by created_at; ties break by higher id. */
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
 * Projects the section-first sellable catalog. Untrusted authors, non-sellable
 * definitions, non-product classes (roles, memberships, event access), and
 * malformed definitions never appear. Definitions from other trusted keys DO
 * appear — ownership only controls editability (MENU-05), decided by the
 * caller comparing `item.author` with the active staff pubkey.
 *
 * Venue binding is owned by the caller: only events learned from the active
 * venue relay reach this fold.
 */
export function projectMenu({ definitions, trustedAuthors }: MenuProjectionInput): MenuSection[] {
  const latest = latestDefinitions(definitions);
  const bySection = new Map<string, MenuItem[]>();

  for (const definition of latest.values()) {
    if (!trustedAuthors.has(definition.author)) continue;
    if (!definition.sellable) continue;
    const type = definition.type ?? "";
    if (!PRODUCT_TYPES.has(type)) continue;
    const name = definition.name?.trim() ?? "";
    if (name.length < 2) continue;

    const availability = AVAILABILITY.has(definition.availability ?? "")
      ? (definition.availability as MenuAvailability)
      : "available";
    const sectionName = definition.section?.trim() ?? "";
    const item: MenuItem = {
      address: addressOf(definition),
      id: definition.id,
      d: definition.d,
      author: definition.author,
      type,
      name,
      ...(definition.description ? { description: definition.description } : {}),
      ...(definition.price ? { price: definition.price } : {}),
      ...(definition.currency ? { currency: definition.currency } : {}),
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
      // §3.2: deterministic position, ties break by d.
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
