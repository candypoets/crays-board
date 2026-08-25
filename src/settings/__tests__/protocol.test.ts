/// <reference types="jest" />

import {
  buildMembershipDefinition,
  buildVenueProfile,
  MAX_DESCRIPTION_LENGTH,
  validateMembershipDraft,
  validateProfileDraft,
  VENUE_PROFILE_D,
  type MembershipDraft,
  type ProfileDraft,
} from "../protocol";

const validProfile: ProfileDraft = {
  hospitalityType: "Hospitality",
  description: "Food, music, and room for a good conversation.",
  menuUrl: "https://maisoncrays.com/menu",
  bookingUrl: "https://maisoncrays.com/reservations",
};

const validMembership: MembershipDraft = {
  d: "qa-membership-1",
  name: "Community member",
  description: "Support the venue.",
  period: "monthly",
  price: "12.00",
  currency: "EUR",
  availability: "available",
};

const tags = (template: { tags: string[][] }) => new Map(template.tags.map((tag) => [tag[0], tag[1]]));

describe("validateProfileDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateProfileDraft(validProfile)).toBeNull();
  });

  it("accepts empty optional URLs", () => {
    expect(validateProfileDraft({ ...validProfile, menuUrl: "", bookingUrl: "  " })).toBeNull();
  });

  it("rejects an empty hospitality type", () => {
    expect(validateProfileDraft({ ...validProfile, hospitalityType: " " })).toMatch(/hospitality/i);
  });

  it(`rejects a description over ${MAX_DESCRIPTION_LENGTH} characters`, () => {
    const description = "x".repeat(MAX_DESCRIPTION_LENGTH + 1);
    expect(validateProfileDraft({ ...validProfile, description })).toMatch(/200/);
    expect(validateProfileDraft({ ...validProfile, description: "x".repeat(MAX_DESCRIPTION_LENGTH) })).toBeNull();
  });

  it("rejects malformed and non-http(s) URLs", () => {
    expect(validateProfileDraft({ ...validProfile, menuUrl: "not a url" })).toMatch(/menu/i);
    expect(validateProfileDraft({ ...validProfile, bookingUrl: "ftp://example.com" })).toMatch(/booking/i);
  });
});

describe("buildVenueProfile", () => {
  it("publishes kind 30078 at the stable nuts-community-profile d", () => {
    const template = buildVenueProfile(validProfile, "Maison Crays");
    expect(template.kind).toBe(30078);
    expect(template.content).toBe("");
    const map = tags(template);
    expect(map.get("d")).toBe(VENUE_PROFILE_D);
    expect(map.get("type")).toBe("Hospitality");
    expect(map.get("name")).toBe("Maison Crays");
    expect(map.get("about")).toBe(validProfile.description);
    expect(map.get("menu_url")).toBe(validProfile.menuUrl);
    expect(map.get("booking_url")).toBe(validProfile.bookingUrl);
  });

  it("omits empty optional tags instead of publishing broken values", () => {
    const template = buildVenueProfile({ ...validProfile, description: " ", menuUrl: "", bookingUrl: "" });
    const names = template.tags.map((tag) => tag[0]);
    expect(names).toEqual(["d", "type"]);
  });

  it("throws instead of building an invalid profile (no broken writes)", () => {
    expect(() => buildVenueProfile({ ...validProfile, menuUrl: "::::" })).toThrow();
  });
});

describe("validateMembershipDraft", () => {
  it("accepts one-time, monthly, and yearly plans", () => {
    for (const period of ["one-time", "monthly", "yearly"] as const) {
      expect(validateMembershipDraft({ ...validMembership, period })).toBeNull();
    }
  });

  it("rejects short names, non-positive prices, and bad currencies", () => {
    expect(validateMembershipDraft({ ...validMembership, name: "x" })).toMatch(/name/i);
    expect(validateMembershipDraft({ ...validMembership, price: "0" })).toMatch(/price/i);
    expect(validateMembershipDraft({ ...validMembership, price: "-4" })).toMatch(/price/i);
    expect(validateMembershipDraft({ ...validMembership, price: "abc" })).toMatch(/price/i);
    expect(validateMembershipDraft({ ...validMembership, currency: "eur" })).toMatch(/currency/i);
    expect(validateMembershipDraft({ ...validMembership, currency: "EURO" })).toMatch(/currency/i);
  });

  it("rejects unknown periods and availability values", () => {
    expect(
      validateMembershipDraft({ ...validMembership, period: "weekly" as MembershipDraft["period"] }),
    ).toMatch(/period/i);
    expect(
      validateMembershipDraft({ ...validMembership, availability: "paused" as MembershipDraft["availability"] }),
    ).toMatch(/availability/i);
  });
});

describe("buildMembershipDefinition", () => {
  it("builds the NIP-97 membership tag set at the stable d", () => {
    const template = buildMembershipDefinition(validMembership);
    expect(template.kind).toBe(30009);
    expect(template.tags).toEqual([
      ["d", "qa-membership-1"],
      ["t", "membership"],
      ["name", "Community member"],
      ["price", "12.00", "EUR", "month"],
      ["availability", "available"],
      ["description", "Support the venue."],
    ]);
  });

  it("maps billing periods to price-tag recurrence: year maps, one-time is absent", () => {
    const priceTag = (period: (typeof validMembership)["period"]) =>
      buildMembershipDefinition({ ...validMembership, period }).tags.find((tag) => tag[0] === "price");
    expect(priceTag("monthly")).toEqual(["price", "12.00", "EUR", "month"]);
    expect(priceTag("yearly")).toEqual(["price", "12.00", "EUR", "year"]);
    expect(priceTag("one-time")).toEqual(["price", "12.00", "EUR"]);
  });

  it("never emits the old type/sellable/period/currency grammar", () => {
    const template = buildMembershipDefinition(validMembership);
    const names = template.tags.map((tag) => tag[0]);
    expect(names).not.toContain("type");
    expect(names).not.toContain("period");
    expect(names).not.toContain("currency");
    expect(template.tags.filter((tag) => tag[0] === "t")).toEqual([["t", "membership"]]);
  });

  it("keeps the same d on availability flips (MEMBER-02)", () => {
    const flipped = buildMembershipDefinition({ ...validMembership, availability: "unavailable" });
    expect(tags(flipped).get("d")).toBe(validMembership.d);
    expect(tags(flipped).get("availability")).toBe("unavailable");
  });

  it("throws on invalid drafts", () => {
    expect(() => buildMembershipDefinition({ ...validMembership, price: "0" })).toThrow();
  });
});
