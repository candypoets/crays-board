import { filterMenu, projectMenu, UNSECTIONED, type MenuDefinitionInput } from "../fold";

const ADMIN = "a".repeat(64);
const FOREIGN = "b".repeat(64);
const UNTRUSTED = "c".repeat(64);
const TRUSTED = new Set([ADMIN, FOREIGN]);

let counter = 0;
function definition(overrides: Partial<MenuDefinitionInput>): MenuDefinitionInput {
  counter += 1;
  return {
    id: `${String(counter).padStart(4, "0")}${"0".repeat(60)}`,
    author: ADMIN,
    d: `item-${counter}`,
    type: "food",
    name: "Test item",
    price: "5.00",
    currency: "EUR",
    availability: "available",
    sellable: true,
    maxUses: 1,
    createdAt: 1_700_000_000 + counter,
    ...overrides,
  };
}

describe("projectMenu", () => {
  it("groups sellable products into ordered sections with positional item order", () => {
    const sections = projectMenu({
      trustedAuthors: TRUSTED,
      definitions: [
        definition({ d: "espresso", type: "drink", name: "Espresso", section: "Drinks", position: 3 }),
        definition({ d: "soup", name: "Tomato soup", section: "Mains", position: 1 }),
        definition({ d: "aubergine", name: "Miso aubergine", section: "Mains", position: 2 }),
        definition({ d: "lemonade", type: "drink", name: "Lemonade", section: "Drinks", position: 4 }),
      ],
    });
    expect(sections.map((section) => section.name)).toEqual(["Mains", "Drinks"]);
    expect(sections[0]?.items.map((item) => item.d)).toEqual(["soup", "aubergine"]);
    expect(sections[1]?.items.map((item) => item.d)).toEqual(["espresso", "lemonade"]);
  });

  it("keeps only the latest addressable event per address", () => {
    const sections = projectMenu({
      trustedAuthors: TRUSTED,
      definitions: [
        definition({ id: `${"1".repeat(64)}`, d: "soup", name: "Old soup", createdAt: 100 }),
        definition({ id: `${"2".repeat(64)}`, d: "soup", name: "New soup", availability: "unavailable", createdAt: 200 }),
      ],
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.items).toHaveLength(1);
    expect(sections[0]?.items[0]?.name).toBe("New soup");
    expect(sections[0]?.items[0]?.availability).toBe("unavailable");
  });

  it("breaks created_at ties by the higher event id", () => {
    const sections = projectMenu({
      trustedAuthors: TRUSTED,
      definitions: [
        definition({ id: `${"f".repeat(64)}`, d: "soup", name: "Higher id wins", createdAt: 100 }),
        definition({ id: `${"1".repeat(64)}`, d: "soup", name: "Lower id loses", createdAt: 100 }),
      ],
    });
    expect(sections[0]?.items[0]?.name).toBe("Higher id wins");
  });

  it("projects items from other trusted keys but never from untrusted authors", () => {
    const sections = projectMenu({
      trustedAuthors: TRUSTED,
      definitions: [
        definition({ d: "mine", name: "Admin soup" }),
        definition({ d: "foreign", author: FOREIGN, name: "Foreign lemonade", type: "drink" }),
        definition({ d: "intruder", author: UNTRUSTED, name: "Intruder special" }),
      ],
    });
    const names = sections.flatMap((section) => section.items.map((item) => item.name));
    expect(names).toContain("Admin soup");
    expect(names).toContain("Foreign lemonade");
    expect(names).not.toContain("Intruder special");
  });

  it("excludes non-sellable, non-product, and malformed definitions", () => {
    const sections = projectMenu({
      trustedAuthors: TRUSTED,
      definitions: [
        definition({ d: "role", type: "role", name: "Chef role", sellable: false }),
        definition({ d: "membership", type: "membership", name: "Monthly member" }),
        definition({ d: "pass", type: "event_access", name: "Gala entry" }),
        definition({ d: "blank", name: "x" }),
        definition({ d: "unnamed", name: undefined }),
      ],
    });
    expect(sections).toHaveLength(0);
  });

  it("places unsectioned items in a trailing Other group and defaults availability", () => {
    const sections = projectMenu({
      trustedAuthors: TRUSTED,
      definitions: [
        definition({ d: "soup", name: "Soup", section: "Mains", position: 5 }),
        definition({ d: "odd", name: "Odd plate", availability: undefined }),
      ],
    });
    expect(sections.map((section) => section.name)).toEqual(["Mains", UNSECTIONED]);
    expect(sections[1]?.items[0]?.availability).toBe("available");
  });
});

describe("filterMenu", () => {
  const sections = projectMenu({
    trustedAuthors: TRUSTED,
    definitions: [
      definition({ d: "soup", name: "Tomato soup", description: "Roasted tomato", section: "Mains" }),
      definition({ d: "espresso", type: "drink", name: "Espresso", section: "Drinks" }),
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
