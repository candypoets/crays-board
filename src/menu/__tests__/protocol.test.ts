/// <reference types="jest" />

import { KIND_LISTING } from "@/nostr/protocol";

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

function tagValues(template: { tags: string[][] }, name: string): string[][] {
  return template.tags.filter((tag) => tag[0] === name).map((tag) => tag.slice(1));
}

describe("validateMenuDraft", () => {
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
  it("builds the exact NIP-97/NIP-99 kind 30402 listing tag set", () => {
    const template = buildMenuDefinition({ d: "soup", type: "food", draft: validDraft, position: 2 });
    expect(template.kind).toBe(KIND_LISTING);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["d", "soup"],
      ["title", "Tomato soup"],
      ["price", "6.50", "EUR"],
      ["availability", "available"],
      ["product_kind", "food"],
      ["section", "Mains"],
      ["position", "2"],
      ["summary", "Roasted tomato, basil oil"],
    ]);
  });

  it("never emits legacy type/t/currency/max_uses markers", () => {
    const template = buildMenuDefinition({ d: "soup", type: "food", draft: validDraft, position: 2 });
    for (const legacy of ["type", "t", "currency", "max_uses", "name", "description"]) {
      expect(tagValues(template, legacy)).toEqual([]);
    }
  });

  it("omits optional tags when the draft leaves them blank", () => {
    const template = buildMenuDefinition({
      d: "soup",
      type: "food",
      draft: { ...validDraft, description: "  ", section: "" },
    });
    expect(tagValues(template, "summary")).toEqual([]);
    expect(tagValues(template, "section")).toEqual([]);
    expect(tagValues(template, "position")).toEqual([]);
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

describe("buildMenuDefinitionUpdate (addressable update rule)", () => {
  const item: MenuItem = {
    address: `30402:${"a".repeat(64)}:soup`,
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

  it("reuses the same d, product kind, and position for an availability flip", () => {
    const template = buildMenuDefinitionUpdate(item, { ...draftFromItem(item), availability: "unavailable" });
    expect(template.kind).toBe(KIND_LISTING);
    expect(tagValues(template, "d")).toEqual([["soup"]]);
    expect(tagValues(template, "product_kind")).toEqual([["food"]]);
    expect(tagValues(template, "position")).toEqual([["1"]]);
    expect(tagValues(template, "availability")).toEqual([["unavailable"]]);
    expect(tagValues(template, "title")).toEqual([["Tomato soup"]]);
    expect(tagValues(template, "price")).toEqual([["6.50", "EUR"]]);
  });

  it("archives and restores through the same addressable mechanism", () => {
    const archived = buildMenuDefinitionUpdate(item, { ...draftFromItem(item), availability: "archived" });
    expect(tagValues(archived, "d")).toEqual([["soup"]]);
    expect(tagValues(archived, "availability")).toEqual([["archived"]]);
    const restored = buildMenuDefinitionUpdate(item, { ...draftFromItem(item), availability: "available" });
    expect(tagValues(restored, "availability")).toEqual([["available"]]);
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
