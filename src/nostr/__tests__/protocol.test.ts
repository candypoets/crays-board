/// <reference types="jest" />

import {
  buildOrderStatus,
  KIND_ANCHOR,
  KIND_AWARD,
  KIND_BADGE_DEFINITION,
  KIND_LISTING,
  KIND_PRESENTATION,
  KIND_REVOCATION,
  KIND_STATUS,
  KIND_VENUE_PROFILE,
  nextStatusCreatedAt,
} from "@/nostr/protocol";

const ADMIN = "a".repeat(64);
const HOLDER = "b".repeat(64);
const AWARD_ID = "c".repeat(64);
const ADDRESS = `30402:${ADMIN}:qa-item`;
const EVENT_COORDINATE = `31923:${ADMIN}:friday-jazz`;

describe("kind registry", () => {
  it("matches the NIP-97 contract", () => {
    expect(KIND_ANCHOR).toBe(31727);
    expect(KIND_BADGE_DEFINITION).toBe(30009);
    expect(KIND_LISTING).toBe(30402);
    expect(KIND_AWARD).toBe(8);
    expect(KIND_REVOCATION).toBe(5);
    expect(KIND_PRESENTATION).toBe(27236);
    expect(KIND_STATUS).toBe(37237);
    expect(KIND_VENUE_PROFILE).toBe(30078);
  });
});

describe("nextStatusCreatedAt", () => {
  it("stays monotonic when the latest status is in the same second", () => {
    const now = 1_800_000_000;
    expect(nextStatusCreatedAt(undefined, now)).toBe(now);
    expect(nextStatusCreatedAt(now - 5, now)).toBe(now);
    expect(nextStatusCreatedAt(now, now)).toBe(now + 1);
    expect(nextStatusCreatedAt(now + 10, now)).toBe(now + 11);
  });
});

describe("buildOrderStatus", () => {
  it("produces the exact NIP-97 order-context tag set", () => {
    const before = Math.floor(Date.now() / 1000);
    const template = buildOrderStatus({
      awardId: AWARD_ID,
      definitionAddress: ADDRESS,
      holderPubkey: HOLDER,
      status: "accepted",
      context: { type: "order", orderRef: "CR-1" },
    });
    const after = Math.floor(Date.now() / 1000);

    expect(template.kind).toBe(37237);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["status", "accepted"],
      ["a", ADDRESS],
      ["e", AWARD_ID],
      ["p", HOLDER],
      ["order", "CR-1"],
      ["d", "order:CR-1"],
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
        context: { type: "order", orderRef: "CR-1" },
      });
      expect(template.tags).toContainEqual(["status", status]);
    },
  );

  it("builds event contexts", () => {
    const template = buildOrderStatus({
      awardId: AWARD_ID,
      definitionAddress: `30402:${ADMIN}:friday-jazz-ticket`,
      holderPubkey: HOLDER,
      status: "fulfilled",
      context: { type: "event", eventCoordinate: EVENT_COORDINATE },
    });
    expect(template.tags).toEqual([
      ["status", "fulfilled"],
      ["a", `30402:${ADMIN}:friday-jazz-ticket`],
      ["e", AWARD_ID],
      ["p", HOLDER],
      ["event", EVENT_COORDINATE],
      ["d", `event:${EVENT_COORDINATE}`],
    ]);
  });

  it("keeps created_at monotonic against the retained status", () => {
    const future = Math.floor(Date.now() / 1000) + 60;
    const template = buildOrderStatus({
      awardId: AWARD_ID,
      definitionAddress: ADDRESS,
      holderPubkey: HOLDER,
      status: "ready",
      context: { type: "order", orderRef: "CR-1" },
      latestStatusCreatedAt: future,
    });
    expect(template.created_at).toBe(future + 1);
  });

  it("never builds a pending status", () => {
    expect(() =>
      buildOrderStatus({
        awardId: AWARD_ID,
        definitionAddress: ADDRESS,
        holderPubkey: HOLDER,
        // @ts-expect-error pending is implicit and never published
        status: "pending",
        context: { type: "order", orderRef: "CR-1" },
      }),
    ).toThrow();
  });

  it("rejects malformed inputs", () => {
    const base = {
      awardId: AWARD_ID,
      definitionAddress: ADDRESS,
      holderPubkey: HOLDER,
      status: "accepted" as const,
      context: { type: "order" as const, orderRef: "CR-1" },
    };
    expect(() => buildOrderStatus({ ...base, awardId: "not-hex" })).toThrow();
    expect(() => buildOrderStatus({ ...base, definitionAddress: `8:${ADMIN}:qa-item` })).toThrow();
    expect(() => buildOrderStatus({ ...base, definitionAddress: `30402:${ADMIN}:` })).toThrow();
    expect(() => buildOrderStatus({ ...base, holderPubkey: "npub1..." })).toThrow();
    // @ts-expect-error unknown status value
    expect(() => buildOrderStatus({ ...base, status: "done" })).toThrow();
    expect(() => buildOrderStatus({ ...base, context: { type: "order", orderRef: "" } })).toThrow();
    expect(() =>
      buildOrderStatus({ ...base, context: { type: "event", eventCoordinate: "not-an-address" } }),
    ).toThrow();
    expect(() =>
      buildOrderStatus({ ...base, context: { type: "event", eventCoordinate: `30402:${ADMIN}:x` } }),
    ).toThrow();
    // @ts-expect-error unknown context type
    expect(() => buildOrderStatus({ ...base, context: { type: "table", orderRef: "CR-1" } })).toThrow();
  });
});
