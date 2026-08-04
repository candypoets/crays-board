/// <reference types="jest" />

import {
  cancellationAction,
  isValidTransition,
  nextOrderAction,
  orderStageIndex,
  projectOrders,
  type AwardInput,
  type DefinitionInput,
  type OrderStatus,
  type StatusInput,
} from "@/orders/fold";
import type { OrderContext, PublishedOrderStatus } from "@/nostr/protocol";

const ADMIN = "a".repeat(64);
const ISSUER = "b".repeat(64);
const STRANGER = "f".repeat(64);
const HOLDER = "c".repeat(64);
const AWARD_ID = "d".repeat(64);
const ADDRESS = `30009:${ADMIN}:qa-item`;
const NOW = 1_000_000;

const TRUSTED = new Set([ADMIN, ISSUER]);

const definition: DefinitionInput = {
  address: ADDRESS,
  id: "0".repeat(64),
  name: "Miso aubergine",
  type: "food",
  sellable: true,
  maxUses: 1,
  createdAt: 50,
};

function award(overrides: Partial<AwardInput> = {}): AwardInput {
  return {
    id: AWARD_ID,
    issuerPubkey: ISSUER,
    definitionAddress: ADDRESS,
    holderPubkey: HOLDER,
    createdAt: 100,
    ...overrides,
  };
}

function status(
  idSuffix: string,
  value: PublishedOrderStatus,
  createdAt: number,
  overrides: Partial<StatusInput> = {},
): StatusInput {
  return {
    id: idSuffix.padStart(64, "0"),
    authorPubkey: ADMIN,
    contextKey: AWARD_ID,
    status: value,
    context: "order",
    createdAt,
    ...overrides,
  };
}

function project(input: {
  awards?: AwardInput[];
  definitions?: DefinitionInput[];
  statuses?: StatusInput[];
  trustedIssuers?: ReadonlySet<string>;
  now?: number;
}) {
  return projectOrders({
    awards: input.awards ?? [award()],
    definitions: input.definitions ?? [definition],
    statuses: input.statuses ?? [],
    trustedIssuers: input.trustedIssuers ?? TRUSTED,
    now: input.now ?? NOW,
  });
}

describe("order projection fold", () => {
  it("projects a trusted single-use award with no status as implicitly pending", () => {
    const [order] = project({});
    expect(order.status).toBe("pending");
    expect(order.itemName).toBe("Miso aubergine");
    expect(order.awardId).toBe(AWARD_ID);
    expect(order.definitionAddress).toBe(ADDRESS);
    expect(order.holderPubkey).toBe(HOLDER);
    expect(order.elapsedSeconds).toBe(NOW - 100);
    expect(order.declined).toBe(false);
  });

  it("advances the ladder one stage at a time to fulfilled", () => {
    const [order] = project({
      statuses: [
        status("1", "accepted", 110),
        status("2", "processing", 120),
        status("3", "ready", 130),
        status("4", "fulfilled", 140),
      ],
    });
    expect(order.status).toBe("fulfilled");
    expect(order.updatedAt).toBe(140);
  });

  it("rejects a backward move", () => {
    const [order] = project({
      statuses: [
        status("1", "accepted", 110),
        status("2", "processing", 115),
        status("3", "ready", 120),
        status("4", "accepted", 130),
      ],
    });
    expect(order.status).toBe("ready");
  });

  it("rejects a stage skip", () => {
    const [order] = project({ statuses: [status("1", "processing", 110)] });
    expect(order.status).toBe("pending");
  });

  it("rejects actions on a terminal order", () => {
    const [served] = project({
      statuses: [
        status("1", "accepted", 110),
        status("2", "processing", 120),
        status("3", "ready", 130),
        status("4", "fulfilled", 140),
        status("5", "cancelled", 150),
      ],
    });
    expect(served.status).toBe("fulfilled");

    const [cancelled] = project({
      statuses: [status("1", "accepted", 110), status("2", "cancelled", 120), status("3", "processing", 130)],
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("resolves created_at ties by higher event id", () => {
    // Same timestamp: the accepted event has the lower id, the processing
    // event the higher id, so processing is the resolved state (§6.6).
    const [order] = project({
      statuses: [status("aaaa", "accepted", 110), status("zzzz", "processing", 110)],
    });
    expect(order.status).toBe("processing");
  });

  it("ignores stale statuses older than the resolved state", () => {
    const [order] = project({
      statuses: [status("1", "accepted", 200), status("2", "processing", 100)],
    });
    expect(order.status).toBe("accepted");
  });

  it("treats cancelled from implicit pending as a decline", () => {
    const [order] = project({ statuses: [status("1", "cancelled", 110)] });
    expect(order.status).toBe("cancelled");
    expect(order.declined).toBe(true);
  });

  it("treats cancelled after acceptance as a plain cancellation", () => {
    const [order] = project({
      statuses: [status("1", "accepted", 110), status("2", "cancelled", 120)],
    });
    expect(order.status).toBe("cancelled");
    expect(order.declined).toBe(false);
  });

  it("excludes awards from untrusted issuers", () => {
    expect(project({ awards: [award({ issuerPubkey: STRANGER })] })).toHaveLength(0);
  });

  it("ignores statuses from untrusted authors", () => {
    const [order] = project({
      statuses: [status("1", "accepted", 110, { authorPubkey: STRANGER })],
    });
    expect(order.status).toBe("pending");
  });

  it("keeps an order diagnosable when its definition is temporarily missing", () => {
    const [order] = project({ definitions: [] });
    expect(order.status).toBe("pending");
    expect(order.itemName).toBeUndefined();
  });

  it("excludes awards whose definition is not a sellable single-use item", () => {
    const reusable: DefinitionInput = {
      ...definition,
      type: "pass",
      maxUses: undefined,
    };
    expect(project({ definitions: [reusable] })).toHaveLength(0);

    const notSellable: DefinitionInput = { ...definition, sellable: false };
    expect(project({ definitions: [notSellable] })).toHaveLength(0);
  });

  it("excludes expired awards", () => {
    expect(project({ awards: [award({ expiresAt: NOW - 1 })] })).toHaveLength(0);
    expect(project({ awards: [award({ expiresAt: NOW + 10 })] })).toHaveLength(1);
  });

  it("lets event contexts go directly to fulfilled (check-in)", () => {
    const eventAward = award({ definitionAddress: `30009:${ADMIN}:ticket` });
    const ticket: DefinitionInput = {
      ...definition,
      address: `30009:${ADMIN}:ticket`,
      type: "event_access",
    };
    const [order] = project({
      awards: [eventAward],
      definitions: [ticket],
      statuses: [status("1", "fulfilled", 110, { context: "event" as OrderContext })],
    });
    expect(order.status).toBe("fulfilled");
  });

  it("orders active orders oldest-first and terminal orders last", () => {
    const older = award({ id: "1".repeat(64), createdAt: 90 });
    const newer = award({ id: "2".repeat(64), createdAt: 100 });
    const done = award({ id: "3".repeat(64), createdAt: 80 });
    const orders = project({
      awards: [newer, done, older],
      statuses: [
        status("1", "accepted", 200, { contextKey: done.id }),
        status("2", "cancelled", 210, { contextKey: done.id }),
      ],
    });
    expect(orders.map((order) => order.awardId)).toEqual([older.id, newer.id, done.id]);
  });
});

describe("isValidTransition", () => {
  it("encodes the §6.2 ladder", () => {
    expect(isValidTransition("pending", "accepted", "order")).toBe(true);
    expect(isValidTransition("pending", "processing", "order")).toBe(false);
    expect(isValidTransition("accepted", "processing", "order")).toBe(true);
    expect(isValidTransition("processing", "ready", "order")).toBe(true);
    expect(isValidTransition("ready", "fulfilled", "order")).toBe(true);
    expect(isValidTransition("fulfilled", "cancelled", "order")).toBe(false);
    expect(isValidTransition("cancelled", "accepted", "order")).toBe(false);
    expect(isValidTransition("ready", "cancelled", "order")).toBe(true);
    expect(isValidTransition("pending", "cancelled", "order")).toBe(true);
    expect(isValidTransition("pending", "fulfilled", "order")).toBe(false);
    expect(isValidTransition("pending", "fulfilled", "event")).toBe(true);
  });
});

describe("nextOrderAction", () => {
  it("offers exactly one valid next action per non-terminal stage", () => {
    expect(nextOrderAction("pending")).toEqual({ to: "accepted", label: "Accept", confirm: false });
    expect(nextOrderAction("accepted")).toEqual({ to: "processing", label: "Start preparing", confirm: false });
    expect(nextOrderAction("processing")).toEqual({ to: "ready", label: "Mark ready", confirm: false });
    expect(nextOrderAction("ready")).toEqual({ to: "fulfilled", label: "Serve", confirm: false });
  });

  it("offers no next action on terminal stages", () => {
    expect(nextOrderAction("fulfilled")).toBeNull();
    expect(nextOrderAction("cancelled")).toBeNull();
  });

  it("never offers an invalid transition", () => {
    const stages: OrderStatus[] = ["pending", "accepted", "processing", "ready", "fulfilled", "cancelled"];
    for (const from of stages) {
      const action = nextOrderAction(from);
      if (action) expect(isValidTransition(from, action.to, "order")).toBe(true);
    }
  });
});

describe("orderStageIndex", () => {
  it("ranks the ladder monotonically with cancelled last", () => {
    expect(orderStageIndex("pending")).toBeLessThan(orderStageIndex("accepted"));
    expect(orderStageIndex("accepted")).toBeLessThan(orderStageIndex("processing"));
    expect(orderStageIndex("processing")).toBeLessThan(orderStageIndex("ready"));
    expect(orderStageIndex("ready")).toBeLessThan(orderStageIndex("fulfilled"));
    expect(orderStageIndex("fulfilled")).toBeLessThan(orderStageIndex("cancelled"));
  });
});

describe("cancellationAction", () => {
  it("declines from pending without confirmation", () => {
    expect(cancellationAction("pending")).toEqual({ to: "cancelled", label: "Decline", confirm: false });
  });

  it("cancels accepted and processing orders with confirmation", () => {
    expect(cancellationAction("accepted")).toEqual({ to: "cancelled", label: "Cancel order", confirm: true });
    expect(cancellationAction("processing")).toEqual({ to: "cancelled", label: "Cancel order", confirm: true });
  });

  it("offers no cancellation on ready or terminal stages", () => {
    expect(cancellationAction("ready")).toBeNull();
    expect(cancellationAction("fulfilled")).toBeNull();
    expect(cancellationAction("cancelled")).toBeNull();
  });
});
