/// <reference types="jest" />

import { buildOrderTransitionStatus } from "@/orders/builders";
import { KIND_STATUS } from "@/nostr/protocol";

const ADMIN = "a".repeat(64);
const HOLDER = "c".repeat(64);
const AWARD_ID = "d".repeat(64);
const ADDRESS = `30402:${ADMIN}:qa-item`;

const base = {
  awardId: AWARD_ID,
  definitionAddress: ADDRESS,
  holderPubkey: HOLDER,
  status: "accepted" as const,
  orderRef: "CR-1",
};

const tag = (template: { tags: string[][] }, name: string) => template.tags.find((entry) => entry[0] === name)?.[1];

describe("buildOrderTransitionStatus", () => {
  it("addresses every transition at the order context (NIP-97)", () => {
    const accepted = buildOrderTransitionStatus(base);
    expect(accepted.kind).toBe(KIND_STATUS);
    expect(tag(accepted, "d")).toBe("order:CR-1");
    expect(tag(accepted, "order")).toBe("CR-1");
    expect(tag(accepted, "e")).toBe(AWARD_ID);
    expect(tag(accepted, "a")).toBe(ADDRESS);
    expect(tag(accepted, "p")).toBe(HOLDER);
    expect(tag(accepted, "status")).toBe("accepted");
  });

  it("keeps one stable d across the ladder so the relay retains the latest per context", () => {
    const stages = ["accepted", "processing", "ready", "fulfilled", "cancelled"] as const;
    const ds = stages.map((status) => tag(buildOrderTransitionStatus({ ...base, status }), "d"));
    expect(new Set(ds).size).toBe(1);
    expect(ds[0]).toBe("order:CR-1");
  });

  it("reuses the same d when the same stage is republished (idempotent retry)", () => {
    const first = buildOrderTransitionStatus(base);
    const retry = buildOrderTransitionStatus(base);
    expect(tag(first, "d")).toBe(tag(retry, "d"));
  });

  it("advances created_at monotonically when rewriting the context", () => {
    const future = Math.floor(Date.now() / 1000) + 30;
    const template = buildOrderTransitionStatus({ ...base, latestStatusCreatedAt: future });
    expect(template.created_at).toBe(future + 1);
  });

  it("keeps the protocol validation", () => {
    expect(() => buildOrderTransitionStatus({ ...base, awardId: "not-hex" })).toThrow();
    expect(() => buildOrderTransitionStatus({ ...base, status: "done" as never })).toThrow();
    expect(() => buildOrderTransitionStatus({ ...base, orderRef: "" })).toThrow();
  });
});
