/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";
import type { PublishedOrderStatus } from "@/nostr/protocol";
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

const ROOT = "0".repeat(64);
const ADMIN = "a".repeat(64);
const BADGE_ISSUER = "b".repeat(64);
const HOLDER = "c".repeat(64);
const STRANGER = "f".repeat(64);
const AWARD_ID = "d".repeat(64);
const ADDRESS = `30402:${ADMIN}:qa-item`;
const ORDER_REF = "CR-1";
const CONTEXT_KEY = `order:${ORDER_REF}`;
const NOW = 1_000_000;

const TRUST: CommunityTrust = {
  rootPubkey: ROOT,
  admins: new Set([ADMIN]),
  badgeIssuer: BADGE_ISSUER,
};

const definition: DefinitionInput = {
  address: ADDRESS,
  id: "0".repeat(64),
  createdAt: 50,
  name: "Miso aubergine",
  sellable: true,
  maxUses: 1,
  eventLinked: false,
};

function award(overrides: Partial<AwardInput> = {}): AwardInput {
  return {
    id: AWARD_ID,
    issuerPubkey: ADMIN,
    definitionAddress: ADDRESS,
    holderPubkey: HOLDER,
    createdAt: 100,
    orderRef: ORDER_REF,
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
    contextKey: CONTEXT_KEY,
    contextType: "order",
    status: value,
    awardId: AWARD_ID,
    definitionAddress: ADDRESS,
    holderPubkey: HOLDER,
    createdAt,
    ...overrides,
  };
}

function project(input: {
  awards?: AwardInput[];
  definitions?: DefinitionInput[];
  statuses?: StatusInput[];
  revocations?: { authorPubkey: string; references: string[] }[];
  trust?: CommunityTrust;
  now?: number;
}) {
  return projectOrders({
    awards: input.awards ?? [award()],
    definitions: input.definitions ?? [definition],
    statuses: input.statuses ?? [],
    revocations: input.revocations ?? [],
    trust: input.trust ?? TRUST,
    now: input.now ?? NOW,
  });
}

describe("order projection fold", () => {
  it("projects a sellable single-use award with no status as implicitly pending", () => {
    const [order] = project({});
    expect(order.status).toBe("pending");
    expect(order.itemName).toBe("Miso aubergine");
    expect(order.awardId).toBe(AWARD_ID);
    expect(order.definitionAddress).toBe(ADDRESS);
    expect(order.holderPubkey).toBe(HOLDER);
    expect(order.orderRef).toBe(ORDER_REF);
    expect(order.contextKey).toBe(CONTEXT_KEY);
    expect(order.latestStatusCreatedAt).toBeUndefined();
    expect(order.elapsedSeconds).toBe(NOW - 100);
    expect(order.declined).toBe(false);
  });

  it("resolves the latest retained status after earlier ladder stages are replaced", () => {
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
    expect(order.latestStatusCreatedAt).toBe(140);
  });

  it("projects a retained current stage without requiring unavailable history", () => {
    const [order] = project({ statuses: [status("1", "processing", 110)] });
    expect(order.status).toBe("processing");
    expect(order.updatedAt).toBe(110);
  });

  it("resolves created_at ties by lowest event id", () => {
    // Same timestamp: the processing event has the lower id and wins the
    // NIP-97 cross-author resolution.
    const [order] = project({
      statuses: [status("zzzz", "accepted", 110), status("aaaa", "processing", 110)],
    });
    expect(order.status).toBe("processing");
    expect(order.latestStatusCreatedAt).toBe(110);
  });

  it("ignores stale statuses older than the resolved state", () => {
    const [order] = project({
      statuses: [status("1", "accepted", 200), status("2", "processing", 100)],
    });
    expect(order.status).toBe("accepted");
  });

  it("does not invent decline history from a retained cancelled status", () => {
    const [order] = project({ statuses: [status("1", "cancelled", 110)] });
    expect(order.status).toBe("cancelled");
    expect(order.declined).toBe(false);
  });

  it("treats cancelled after acceptance as a plain cancellation", () => {
    const [order] = project({
      statuses: [status("1", "accepted", 110), status("2", "cancelled", 120)],
    });
    expect(order.status).toBe("cancelled");
    expect(order.declined).toBe(false);
  });

  it("excludes awards from issuers outside the anchor trust", () => {
    expect(project({ awards: [award({ issuerPubkey: STRANGER })] })).toHaveLength(0);
  });

  it("lets the delegated badge issuer award sellable definitions only", () => {
    expect(project({ awards: [award({ issuerPubkey: BADGE_ISSUER })] })).toHaveLength(1);

    const notSellable: DefinitionInput = { ...definition, sellable: false };
    expect(
      project({ awards: [award({ issuerPubkey: BADGE_ISSUER })], definitions: [notSellable] }),
    ).toHaveLength(0);
  });

  it("drops a badge-issuer award whose definition is missing (sellable unverifiable)", () => {
    expect(project({ awards: [award({ issuerPubkey: BADGE_ISSUER })], definitions: [] })).toHaveLength(0);
  });

  it("ignores statuses from signers outside the anchor trust", () => {
    const [order] = project({
      statuses: [status("1", "accepted", 110, { authorPubkey: STRANGER })],
    });
    expect(order.status).toBe("pending");
  });

  it("accepts statuses signed by the badge issuer", () => {
    const [order] = project({
      statuses: [status("1", "accepted", 110, { authorPubkey: BADGE_ISSUER })],
    });
    expect(order.status).toBe("accepted");
  });

  it("accepts statuses signed by a resolved 37237/write role holder", () => {
    const delegated = { ...TRUST, fulfillmentRoleHolders: new Set([STRANGER]) };
    const [order] = project({
      trust: delegated,
      statuses: [status("1", "accepted", 110, { authorPubkey: STRANGER })],
    });
    expect(order.status).toBe("accepted");
  });

  it("treats definitions from untrusted authors as missing", () => {
    const foreign: DefinitionInput = { ...definition, address: `30402:${STRANGER}:qa-item` };
    const orders = project({
      awards: [award({ definitionAddress: foreign.address })],
      definitions: [foreign],
    });
    expect(orders).toHaveLength(0);
  });

  it("keeps an order diagnosable when its definition is temporarily missing", () => {
    const [order] = project({ definitions: [] });
    expect(order.status).toBe("pending");
    expect(order.itemName).toBeUndefined();
  });

  it("never projects role or membership awards as orders when their definitions are absent", () => {
    expect(
      project({
        awards: [award({ definitionAddress: `30009:${ADMIN}:staff` })],
        definitions: [],
      }),
    ).toHaveLength(0);
  });

  it("excludes awards whose definition is not a sellable single-use product", () => {
    const pass: DefinitionInput = { ...definition, maxUses: 5 };
    expect(project({ definitions: [pass] })).toHaveLength(0);

    const ticket: DefinitionInput = { ...definition, eventLinked: true };
    expect(project({ definitions: [ticket] })).toHaveLength(0);

    const notSellable: DefinitionInput = { ...definition, sellable: false };
    expect(project({ definitions: [notSellable] })).toHaveLength(0);
  });

  it("excludes expired awards", () => {
    expect(project({ awards: [award({ expiresAt: NOW - 1 })] })).toHaveLength(0);
    expect(project({ awards: [award({ expiresAt: NOW + 10 })] })).toHaveLength(1);
  });

  it("excludes awards revoked by their issuer or an anchor admin", () => {
    expect(
      project({ revocations: [{ authorPubkey: ADMIN, references: [AWARD_ID] }] }),
    ).toHaveLength(0);
    expect(
      project({ revocations: [{ authorPubkey: STRANGER, references: [AWARD_ID] }] }),
    ).toHaveLength(1);
  });

  it("ignores statuses whose context does not match the order", () => {
    const wrongContext = project({
      statuses: [status("1", "accepted", 110, { contextKey: "order:CR-OTHER" })],
    });
    expect(wrongContext[0].status).toBe("pending");

    const wrongAward = project({
      statuses: [status("1", "accepted", 110, { awardId: "9".repeat(64) })],
    });
    expect(wrongAward[0].status).toBe("pending");

    const wrongDefinition = project({
      statuses: [status("1", "accepted", 110, { definitionAddress: `30402:${ADMIN}:other` })],
    });
    expect(wrongDefinition[0].status).toBe("pending");

    const wrongHolder = project({
      statuses: [status("1", "accepted", 110, { holderPubkey: STRANGER })],
    });
    expect(wrongHolder[0].status).toBe("pending");

    const predatesAward = project({ statuses: [status("1", "accepted", 99)] });
    expect(predatesAward[0].status).toBe("pending");
  });

  it("ignores event-context statuses (they belong to check-in)", () => {
    const [order] = project({
      statuses: [
        status("1", "fulfilled", 110, {
          contextKey: `event:31923:${ADMIN}:qa-event`,
          contextType: "event",
        }),
      ],
    });
    expect(order.status).toBe("pending");
  });

  it("orders active orders oldest-first and terminal orders last", () => {
    const older = award({ id: "1".repeat(64), createdAt: 90, orderRef: "CR-1" });
    const newer = award({ id: "2".repeat(64), createdAt: 100, orderRef: "CR-2" });
    const done = award({ id: "3".repeat(64), createdAt: 80, orderRef: "CR-3" });
    const orders = project({
      awards: [newer, done, older],
      statuses: [
        status("1", "accepted", 200, { contextKey: "order:CR-3", awardId: done.id }),
        status("2", "cancelled", 210, { contextKey: "order:CR-3", awardId: done.id }),
      ],
    });
    expect(orders.map((order) => order.awardId)).toEqual([older.id, newer.id, done.id]);
  });
});

describe("isValidTransition", () => {
  it("encodes the fulfillment ladder", () => {
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
