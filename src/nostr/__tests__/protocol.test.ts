/// <reference types="jest" />

import {
  buildOrderStatus,
  KIND_AWARD,
  KIND_DEFINITION,
  KIND_STATUS,
  KIND_VENUE_PROFILE,
} from "@/nostr/protocol";

const ADMIN = "a".repeat(64);
const HOLDER = "b".repeat(64);
const AWARD_ID = "c".repeat(64);
const ADDRESS = `30009:${ADMIN}:qa-item`;

describe("kind registry", () => {
  it("matches the venue-commerce-nip contract", () => {
    expect(KIND_DEFINITION).toBe(30009);
    expect(KIND_AWARD).toBe(8);
    expect(KIND_STATUS).toBe(37237);
    expect(KIND_VENUE_PROFILE).toBe(30078);
  });
});

describe("buildOrderStatus", () => {
  it("produces the exact §6.1 tag set", () => {
    const before = Math.floor(Date.now() / 1000);
    const template = buildOrderStatus({
      awardId: AWARD_ID,
      definitionAddress: ADDRESS,
      holderPubkey: HOLDER,
      status: "accepted",
      context: "order",
    });
    const after = Math.floor(Date.now() / 1000);

    expect(template.kind).toBe(37237);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["d", AWARD_ID],
      ["e", AWARD_ID],
      ["a", ADDRESS],
      ["p", HOLDER],
      ["status", "accepted"],
      ["context", "order"],
    ]);
    expect(template.created_at).toBeGreaterThanOrEqual(before);
    expect(template.created_at).toBeLessThanOrEqual(after);
  });

  it.each(["accepted", "processing", "ready", "fulfilled", "cancelled"] as const)(
    "builds the %s status",
    (status) => {
      const template = buildOrderStatus({
        awardId: AWARD_ID,
        definitionAddress: ADDRESS,
        holderPubkey: HOLDER,
        status,
        context: "order",
      });
      expect(template.tags).toContainEqual(["status", status]);
    },
  );

  it("builds event contexts", () => {
    const template = buildOrderStatus({
      awardId: AWARD_ID,
      definitionAddress: ADDRESS,
      holderPubkey: HOLDER,
      status: "fulfilled",
      context: "event",
    });
    expect(template.tags).toContainEqual(["context", "event"]);
  });

  it("never builds a pending status", () => {
    expect(() =>
      buildOrderStatus({
        awardId: AWARD_ID,
        definitionAddress: ADDRESS,
        holderPubkey: HOLDER,
        // @ts-expect-error pending is implicit and never published
        status: "pending",
        context: "order",
      }),
    ).toThrow();
  });

  it("rejects malformed inputs", () => {
    const base = { awardId: AWARD_ID, definitionAddress: ADDRESS, holderPubkey: HOLDER, status: "accepted" as const, context: "order" as const };
    expect(() => buildOrderStatus({ ...base, awardId: "not-hex" })).toThrow();
    expect(() => buildOrderStatus({ ...base, definitionAddress: `8:${ADMIN}:qa-item` })).toThrow();
    expect(() => buildOrderStatus({ ...base, definitionAddress: `30009:${ADMIN}:` })).toThrow();
    expect(() => buildOrderStatus({ ...base, holderPubkey: "npub1..." })).toThrow();
    // @ts-expect-error unknown status value
    expect(() => buildOrderStatus({ ...base, status: "done" })).toThrow();
    // @ts-expect-error unknown context value
    expect(() => buildOrderStatus({ ...base, context: "table" })).toThrow();
  });
});
