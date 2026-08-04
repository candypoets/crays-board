/// <reference types="jest" />

import { buildOrderTransitionStatus } from "@/orders/builders";
import { KIND_STATUS, type OrderStatusParams } from "@/nostr/protocol";

const ADMIN = "a".repeat(64);
const HOLDER = "c".repeat(64);
const AWARD_ID = "d".repeat(64);
const ADDRESS = `30009:${ADMIN}:qa-item`;

const base: OrderStatusParams = {
  awardId: AWARD_ID,
  definitionAddress: ADDRESS,
  holderPubkey: HOLDER,
  status: "accepted",
  context: "order",
};

const tag = (template: { tags: string[][] }, name: string) => template.tags.find((entry) => entry[0] === name)?.[1];

describe("buildOrderTransitionStatus", () => {
  it("uses a stage-scoped d tag so every ladder transition is retained (§6.7)", () => {
    const accepted = buildOrderTransitionStatus(base);
    expect(accepted.kind).toBe(KIND_STATUS);
    expect(tag(accepted, "d")).toBe(`${AWARD_ID}:accepted`);
    expect(tag(accepted, "e")).toBe(AWARD_ID);
    expect(tag(accepted, "a")).toBe(ADDRESS);
    expect(tag(accepted, "p")).toBe(HOLDER);
    expect(tag(accepted, "status")).toBe("accepted");
    expect(tag(accepted, "context")).toBe("order");
  });

  it("gives each stage a distinct d while the e context stays stable", () => {
    const stages = ["accepted", "processing", "ready", "fulfilled", "cancelled"] as const;
    const ds = stages.map((status) => tag(buildOrderTransitionStatus({ ...base, status }), "d"));
    expect(new Set(ds).size).toBe(stages.length);
    for (const status of stages) {
      const template = buildOrderTransitionStatus({ ...base, status });
      expect(tag(template, "d")).toBe(`${AWARD_ID}:${status}`);
      expect(tag(template, "e")).toBe(AWARD_ID);
    }
  });

  it("reuses the same d when the same stage is republished (idempotent retry)", () => {
    const first = buildOrderTransitionStatus(base);
    const retry = buildOrderTransitionStatus(base);
    expect(tag(first, "d")).toBe(tag(retry, "d"));
  });

  it("keeps the protocol validation", () => {
    expect(() => buildOrderTransitionStatus({ ...base, awardId: "not-hex" })).toThrow();
    expect(() => buildOrderTransitionStatus({ ...base, status: "done" as never })).toThrow();
    expect(() => buildOrderTransitionStatus({ ...base, context: "table" as never })).toThrow();
  });
});
