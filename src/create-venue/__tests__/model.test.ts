import {
  BADGE_D,
  buildRelayRequest,
  buildVenueProfileTemplate,
  deriveSlug,
  emptyDraft,
  makeAttemptId,
  makeDomainLabel,
  stepError,
  toBase64Url,
  validateDescription,
  validateHours,
  validateTimezone,
  validateVenueName,
  VENUE_PROFILE_D,
  VENUE_PROFILE_KIND,
  type VenueDraft,
} from "../model";

const draft = (patch: Partial<VenueDraft> = {}): VenueDraft => ({ ...emptyDraft(), ...patch });

describe("deriveSlug", () => {
  it("normalizes a plain name", () => {
    expect(deriveSlug("Maison Crays")).toBe("maison-crays");
  });

  it("lowercases, collapses separators, and trims hyphens", () => {
    expect(deriveSlug("  The  GRAND — Café!! ")).toBe("the-grand-cafe");
  });

  it("strips diacritics via NFKD", () => {
    expect(deriveSlug("Café Lumière")).toBe("cafe-lumiere");
  });

  it("falls back safely when the name produces nothing usable", () => {
    expect(deriveSlug("مقهى")).toBe("venue");
    expect(deriveSlug("!!!")).toBe("venue");
    expect(deriveSlug("")).toBe("venue");
  });

  it("caps at 63 characters without a trailing hyphen", () => {
    const slug = deriveSlug(`the ${"very ".repeat(20)}long venue name`);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("validateVenueName", () => {
  it("rejects blank, whitespace-only, one-character, and over-50 names", () => {
    expect(validateVenueName("")).toBeTruthy();
    expect(validateVenueName("   ")).toBeTruthy();
    expect(validateVenueName("a")).toBeTruthy();
    expect(validateVenueName("x".repeat(51))).toBeTruthy();
  });

  it("accepts a 2–50 character name", () => {
    expect(validateVenueName("ab")).toBeNull();
    expect(validateVenueName("Maison Crays")).toBeNull();
    expect(validateVenueName("x".repeat(50))).toBeNull();
  });
});

describe("validateDescription", () => {
  it("allows up to 200 characters", () => {
    expect(validateDescription("")).toBeNull();
    expect(validateDescription("y".repeat(200))).toBeNull();
    expect(validateDescription("y".repeat(201))).toBeTruthy();
  });
});

describe("validateTimezone", () => {
  it("requires a plausible IANA value", () => {
    expect(validateTimezone("")).toBeTruthy();
    expect(validateTimezone("Europe/Luxembourg")).toBeNull();
    expect(validateTimezone("UTC")).toBeNull();
    expect(validateTimezone("not a zone!")).toBeTruthy();
  });
});

describe("validateHours", () => {
  it("treats fully empty hours as optional-valid", () => {
    expect(validateHours("", "")).toBeNull();
  });

  it("rejects malformed times and an end before the start", () => {
    expect(validateHours("18:00", "")).toBeTruthy();
    expect(validateHours("25:00", "26:00")).toBeTruthy();
    expect(validateHours("18:00", "17:00")).toBeTruthy();
    expect(validateHours("18:00", "18:00")).toBeTruthy();
  });

  it("accepts a valid window", () => {
    expect(validateHours("18:00", "23:30")).toBeNull();
    expect(validateHours("09:15", "17:00")).toBeNull();
  });
});

describe("stepError gating", () => {
  it("blocks identity until the name is valid", () => {
    expect(stepError(draft(), 0, false)).toBeTruthy();
    expect(stepError(draft({ name: "Maison Crays" }), 0, false)).toBeNull();
  });

  it("blocks place on invalid timezone or hours", () => {
    expect(stepError(draft({ timezone: "" }), 1, false)).toBeTruthy();
    expect(stepError(draft({ opensAt: "18:00", closesAt: "17:00" }), 1, false)).toBeTruthy();
    expect(stepError(draft(), 1, false)).toBeNull();
  });

  it("blocks service until a signer exists and recovery is acknowledged", () => {
    const base = draft({ recoveryAcknowledged: true });
    expect(stepError(base, 2, false)).toBeTruthy();
    expect(stepError(draft(), 2, true)).toBeTruthy();
    expect(stepError(base, 2, true)).toBeNull();
  });

  it("never blocks review", () => {
    expect(stepError(draft(), 3, false)).toBeNull();
  });
});

describe("buildRelayRequest", () => {
  it("carries the venue identity, unique domain label, owner admin key, and badge id", () => {
    const owner = "a".repeat(64);
    const request = buildRelayRequest(draft({ name: " Maison Crays ", description: " Nice room " }), "craysboard-venue-maison-crays-x1y2z", owner.toUpperCase());
    expect(request).toEqual({
      name: "Maison Crays",
      description: "Nice room",
      domain_label: "craysboard-venue-maison-crays-x1y2z",
      admin_pubkeys: [owner],
      badge_d: BADGE_D,
    });
  });
});

describe("attempt id and domain label", () => {
  it("generates distinct stable attempt ids", () => {
    expect(makeAttemptId()).not.toBe(makeAttemptId());
    // 123 decimal is "3f" in base36; the id embeds the timestamp verbatim.
    expect(makeAttemptId(123)).toMatch(/^cv-3f-[a-z0-9]{4}$/);
  });

  it("embeds the slug with a random suffix", () => {
    const label = makeDomainLabel("maison-crays");
    expect(label).toMatch(/^craysboard-venue-maison-crays-[a-z0-9]{5}$/);
    expect(makeDomainLabel("maison-crays")).not.toBe(label);
  });
});

describe("buildVenueProfileTemplate", () => {
  it("is the hospitality venue profile addressable event", () => {
    const template = buildVenueProfileTemplate(draft({ name: "Maison Crays", description: "Food and music." }));
    expect(template.kind).toBe(VENUE_PROFILE_KIND);
    expect(template.tags).toContainEqual(["d", VENUE_PROFILE_D]);
    expect(template.tags).toContainEqual(["type", "hospitality"]);
    expect(template.tags).toContainEqual(["t", "hospitality"]);
    expect(template.tags).toContainEqual(["name", "Maison Crays"]);
    expect(template.tags).toContainEqual(["about", "Food and music."]);
  });

  it("omits about when the description is empty and never fabricates address/hours", () => {
    const template = buildVenueProfileTemplate(draft({ name: "Maison Crays", address: "1 Rue X", opensAt: "18:00", closesAt: "23:00" }));
    const flat = template.tags.map((tag) => tag[0]);
    expect(flat).not.toContain("about");
    expect(flat).not.toContain("address");
    expect(flat).not.toContain("hours");
  });
});

describe("toBase64Url", () => {
  it("encodes ASCII like standard base64url", () => {
    expect(toBase64Url("hello world")).toBe("aGVsbG8gd29ybGQ");
    expect(toBase64Url("f")).toBe("Zg");
    expect(toBase64Url("fo")).toBe("Zm8");
    expect(toBase64Url("foo")).toBe("Zm9v");
  });

  it("handles UTF-8 and url-safe characters", () => {
    expect(toBase64Url("café ☕")).toBe("Y2Fmw6kg4piV");
    expect(toBase64Url("~}?~")).toBe("fn0_fg");
  });
});
