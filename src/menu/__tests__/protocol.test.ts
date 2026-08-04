import { KIND_DEFINITION } from "@/nostr/protocol";

import type { MenuItem } from "../fold";
import {
  buildMenuDefinition,
  buildMenuDefinitionUpdate,
  draftFromItem,
  isMenuDraftValid,
  validateMenuDraft,
  type MenuDraft,
} from "../protocol";

const validDraft: MenuDraft = {
  name: "Tomato soup",
  description: "Roasted tomato, basil oil",
  price: "6.50",
  currency: "EUR",
  section: "Mains",
  availability: "available",
};

function tagsOf(template: { tags: string[][] }): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [name, value] of template.tags) {
    const list = map.get(name) ?? [];
    if (value !== undefined) list.push(value);
    map.set(name, list);
  }
  return map;
}

describe("validateMenuDraft (venue-commerce-nip §3.1)", () => {
  it("accepts a valid draft", () => {
    expect(isMenuDraftValid(validateMenuDraft(validDraft))).toBe(true);
  });

  it("rejects blank and one-character names", () => {
    expect(validateMenuDraft({ ...validDraft, name: "" }).name).toBeTruthy();
    expect(validateMenuDraft({ ...validDraft, name: "  " }).name).toBeTruthy();
    expect(validateMenuDraft({ ...validDraft, name: "x" }).name).toBeTruthy();
  });

  it("rejects non-positive and malformed prices", () => {
    for (const price of ["0", "0.00", "-4", "abc", "4.", "4,50", "4.555", ""]) {
      expect(validateMenuDraft({ ...validDraft, price }).price).toBeTruthy();
    }
    for (const price of ["4", "4.5", "4.50", "0.01"]) {
      expect(validateMenuDraft({ ...validDraft, price }).price).toBeUndefined();
    }
  });

  it("rejects currencies that are not three uppercase letters", () => {
    for (const currency of ["eur", "EU", "EURO", "E1R", ""]) {
      expect(validateMenuDraft({ ...validDraft, currency }).currency).toBeTruthy();
    }
    expect(validateMenuDraft({ ...validDraft, currency: "USD" }).currency).toBeUndefined();
  });
});

describe("buildMenuDefinition", () => {
  it("builds the exact §3.1/§3.2 sellable product tag set", () => {
    const template = buildMenuDefinition({ d: "soup", type: "food", draft: validDraft, position: 2 });
    expect(template.kind).toBe(KIND_DEFINITION);
    expect(template.content).toBe("");
    const tags = tagsOf(template);
    expect(tags.get("d")).toEqual(["soup"]);
    expect(tags.get("type")).toEqual(["food"]);
    expect(tags.get("t")).toEqual(["food", "sellable"]);
    expect(tags.get("name")).toEqual(["Tomato soup"]);
    expect(tags.get("price")).toEqual(["6.50"]);
    expect(tags.get("currency")).toEqual(["EUR"]);
    expect(tags.get("max_uses")).toEqual(["1"]);
    expect(tags.get("availability")).toEqual(["available"]);
    expect(tags.get("section")).toEqual(["Mains"]);
    expect(tags.get("position")).toEqual(["2"]);
    expect(tags.get("description")).toEqual(["Roasted tomato, basil oil"]);
  });

  it("omits optional tags when the draft leaves them blank", () => {
    const template = buildMenuDefinition({
      d: "soup",
      type: "food",
      draft: { ...validDraft, description: "  ", section: "" },
    });
    const tags = tagsOf(template);
    expect(tags.has("description")).toBe(false);
    expect(tags.has("section")).toBe(false);
    expect(tags.has("position")).toBe(false);
  });

  it("throws on invalid drafts and invalid availability so they never publish", () => {
    expect(() => buildMenuDefinition({ d: "soup", type: "food", draft: { ...validDraft, name: "x" } })).toThrow();
    expect(() => buildMenuDefinition({ d: "soup", type: "food", draft: { ...validDraft, price: "0" } })).toThrow();
    expect(() =>
      buildMenuDefinition({ d: "soup", type: "food", draft: { ...validDraft, availability: "gone" as never } }),
    ).toThrow();
    expect(() => buildMenuDefinition({ d: "", type: "food", draft: validDraft })).toThrow();
  });
});

describe("buildMenuDefinitionUpdate (§3.1 update rule)", () => {
  const item: MenuItem = {
    address: `30009:${"a".repeat(64)}:soup`,
    id: "f".repeat(64),
    d: "soup",
    author: "a".repeat(64),
    type: "food",
    name: "Tomato soup",
    price: "6.50",
    currency: "EUR",
    availability: "available",
    section: "Mains",
    position: 1,
    createdAt: 1_700_000_000,
  };

  it("reuses the same d, type, and position for an availability flip", () => {
    const template = buildMenuDefinitionUpdate(item, { ...draftFromItem(item), availability: "unavailable" });
    const tags = tagsOf(template);
    expect(tags.get("d")).toEqual(["soup"]);
    expect(tags.get("type")).toEqual(["food"]);
    expect(tags.get("position")).toEqual(["1"]);
    expect(tags.get("availability")).toEqual(["unavailable"]);
    expect(tags.get("name")).toEqual(["Tomato soup"]);
    expect(tags.get("price")).toEqual(["6.50"]);
  });

  it("archives and restores through the same addressable mechanism", () => {
    const archived = buildMenuDefinitionUpdate(item, { ...draftFromItem(item), availability: "archived" });
    expect(tagsOf(archived).get("d")).toEqual(["soup"]);
    expect(tagsOf(archived).get("availability")).toEqual(["archived"]);
    const restored = buildMenuDefinitionUpdate(item, { ...draftFromItem(item), availability: "available" });
    expect(tagsOf(restored).get("availability")).toEqual(["available"]);
  });

  it("derives the editor draft from the projected item", () => {
    expect(draftFromItem(item)).toEqual({
      name: "Tomato soup",
      description: "",
      price: "6.50",
      currency: "EUR",
      section: "Mains",
      availability: "available",
    });
  });
});
