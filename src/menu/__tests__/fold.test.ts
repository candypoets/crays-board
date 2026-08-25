/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";

import { filterMenu, projectMenu, UNSECTIONED, type MenuDefinitionInput } from "../fold";

const ADMIN = "a".repeat(64);
const FOREIGN = "b".repeat(64);
const UNTRUSTED = "c".repeat(64);
const ROOT = "d".repeat(64);
const BADGE_ISSUER = "e".repeat(64);
const TRUST: CommunityTrust = {
  rootPubkey: ROOT,
  admins: new Set([ADMIN, FOREIGN]),
  badgeIssuer: BADGE_ISSUER,
};

let counter = 0;
function definition(overrides: Partial<MenuDefinitionInput>): MenuDefinitionInput {
  counter += 1;
  return {
    id: `${String(counter).padStart(4, "0")}${"0".repeat(60)}`,
    author: ADMIN,
    d: `item-${counter}`,
    productKind: "food",
    title: "Test item",
    price: { amount: "5.00", currency: "EUR" },
    availability: "available",
    createdAt: 1_700_000_000 + counter,
    ...overrides,
  };
}

describe("projectMenu", () => {
  it("groups sellable products into ordered sections with positional item order", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [
        definition({ d: "espresso", productKind: "drink", title: "Espresso", section: "Drinks", position: 3 }),
        definition({ d: "soup", title: "Tomato soup", section: "Mains", position: 1 }),
        definition({ d: "aubergine", title: "Miso aubergine", section: "Mains", position: 2 }),
        definition({ d: "lemonade", productKind: "drink", title: "Lemonade", section: "Drinks", position: 4 }),
      ],
    });
    expect(sections.map((section) => section.name)).toEqual(["Mains", "Drinks"]);
    expect(sections[0]?.items.map((item) => item.d)).toEqual(["soup", "aubergine"]);
    expect(sections[1]?.items.map((item) => item.d)).toEqual(["espresso", "lemonade"]);
  });

  it("addresses items as 30402 listings", () => {
    const sections = projectMenu({ trust: TRUST, definitions: [definition({ d: "soup", title: "Soup" })] });
    expect(sections[0]?.items[0]?.address).toBe(`30402:${ADMIN}:soup`);
  });

  it("keeps only the latest addressable event per address", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [
        definition({ id: `${"1".repeat(64)}`, d: "soup", title: "Old soup", createdAt: 100 }),
        definition({ id: `${"2".repeat(64)}`, d: "soup", title: "New soup", availability: "unavailable", createdAt: 200 }),
      ],
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.items).toHaveLength(1);
    expect(sections[0]?.items[0]?.name).toBe("New soup");
    expect(sections[0]?.items[0]?.availability).toBe("unavailable");
  });

  it("breaks created_at ties by the higher event id", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [
        definition({ id: `${"f".repeat(64)}`, d: "soup", title: "Higher id wins", createdAt: 100 }),
        definition({ id: `${"1".repeat(64)}`, d: "soup", title: "Lower id loses", createdAt: 100 }),
      ],
    });
    expect(sections[0]?.items[0]?.name).toBe("Higher id wins");
  });

  it("projects items from admins and the root key but never from untrusted authors", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [
        definition({ d: "mine", title: "Admin soup" }),
        definition({ d: "foreign", author: FOREIGN, title: "Foreign lemonade", productKind: "drink" }),
        definition({ d: "root", author: ROOT, title: "Root special" }),
        definition({ d: "intruder", author: UNTRUSTED, title: "Intruder special" }),
        // The delegated badge issuer may award but never authors definitions.
        definition({ d: "issuer", author: BADGE_ISSUER, title: "Issuer plate" }),
      ],
    });
    const names = sections.flatMap((section) => section.items.map((item) => item.name));
    expect(names).toContain("Admin soup");
    expect(names).toContain("Foreign lemonade");
    expect(names).toContain("Root special");
    expect(names).not.toContain("Intruder special");
    expect(names).not.toContain("Issuer plate");
  });

  it("excludes unpriced, ticket-linked, non-product, and malformed listings", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [
        definition({ d: "unpriced", title: "Free sample", price: undefined }),
        definition({ d: "ticket", title: "Gala entry", a: `31923:${ADMIN}:gala` }),
        definition({ d: "dated-ticket", title: "Matinee entry", a: `31922:${ADMIN}:matinee` }),
        definition({ d: "role", productKind: "role", title: "Chef role" }),
        definition({ d: "membership", productKind: "membership", title: "Monthly member" }),
        definition({ d: "blank", title: "x" }),
        definition({ d: "unnamed", title: undefined }),
      ],
    });
    expect(sections).toHaveLength(0);
  });

  it("keeps listings whose a tag points at a non-calendar definition", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [definition({ d: "combo", title: "Combo deal", a: `30402:${ADMIN}:base` })],
    });
    expect(sections.flatMap((section) => section.items.map((item) => item.d))).toEqual(["combo"]);
  });

  it("defaults a missing product_kind to generic", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [definition({ d: "soup", title: "Soup", productKind: undefined })],
    });
    expect(sections[0]?.items[0]?.type).toBe("generic");
  });

  it("reads the display text from summary with description as fallback", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [
        definition({ d: "both", title: "Both", summary: "Summary text", description: "Description text" }),
        definition({ d: "legacy", title: "Legacy", description: "Description text" }),
        definition({ d: "bare", title: "Bare" }),
      ],
    });
    const items = sections.flatMap((section) => section.items);
    expect(items.find((item) => item.d === "both")?.description).toBe("Summary text");
    expect(items.find((item) => item.d === "legacy")?.description).toBe("Description text");
    expect(items.find((item) => item.d === "bare")?.description).toBeUndefined();
  });

  it("places unsectioned items in a trailing Other group and defaults availability", () => {
    const sections = projectMenu({
      trust: TRUST,
      definitions: [
        definition({ d: "soup", title: "Soup", section: "Mains", position: 5 }),
        definition({ d: "odd", title: "Odd plate", availability: undefined }),
      ],
    });
    expect(sections.map((section) => section.name)).toEqual(["Mains", UNSECTIONED]);
    expect(sections[1]?.items[0]?.availability).toBe("available");
  });
});

describe("filterMenu", () => {
  const sections = projectMenu({
    trust: TRUST,
    definitions: [
      definition({ d: "soup", title: "Tomato soup", summary: "Roasted tomato", section: "Mains" }),
      definition({ d: "espresso", productKind: "drink", title: "Espresso", section: "Drinks" }),
    ],
  });

  it("matches search against name and description, case-insensitively", () => {
    expect(filterMenu(sections, { search: "TOMATO" })[0]?.items[0]?.d).toBe("soup");
    expect(filterMenu(sections, { search: "roasted" })).toHaveLength(1);
    expect(filterMenu(sections, { search: "nothing matches" })).toHaveLength(0);
  });

  it("filters by exact section and composes with search", () => {
    const drinks = filterMenu(sections, { section: "Drinks" });
    expect(drinks).toHaveLength(1);
    expect(drinks[0]?.items[0]?.d).toBe("espresso");
    expect(filterMenu(sections, { section: "Drinks", search: "soup" })).toHaveLength(0);
    expect(filterMenu(sections, { section: "Mains", search: "soup" })).toHaveLength(1);
  });
});
