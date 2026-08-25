/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";
import type { PublishedOrderStatus } from "@/nostr/protocol";

import {
  homeMarkerPayload,
  projectHomeSummary,
  type HomeAwardInput,
  type HomeCalendarEventInput,
  type HomeDefinitionInput,
  type HomeProfileInput,
  type HomeStatusInput,
} from "../summary";

const NOW = 1_800_000_000;
const ADMIN = "a".repeat(64);
const ISSUER = "b".repeat(64);
const STRANGER = "c".repeat(64);
const ROOT = "f".repeat(64);
const HOLDER_A = "d".repeat(64);
const HOLDER_B = "e".repeat(64);
const HOLDER_C = "9".repeat(64);

/** NIP-97 trust: anchor admins + root key, with the delegated badge issuer. */
const TRUST: CommunityTrust = {
  rootPubkey: ROOT,
  admins: new Set([ADMIN]),
  badgeIssuer: ISSUER,
};

const PRODUCT = `30402:${ADMIN}:item`;
const MEMBERSHIP = `30009:${ROOT}:members`;

let counter = 0;
function id(): string {
  counter += 1;
  return counter.toString(16).padStart(64, "0");
}

function productDefinition(overrides: Partial<HomeDefinitionInput> & { address: string }): HomeDefinitionInput {
  return {
    id: id(),
    authorPubkey: ADMIN,
    type: "product",
    sellable: true,
    createdAt: NOW - 1000,
    ...overrides,
  };
}

function membershipDefinition(
  address: string,
  overrides: Partial<HomeDefinitionInput> = {},
): HomeDefinitionInput {
  return {
    address,
    id: id(),
    authorPubkey: ROOT,
    type: "membership",
    sellable: true,
    createdAt: NOW - 1000,
    ...overrides,
  };
}

function orderAward(ref: string, elapsedSeconds: number, overrides: Partial<HomeAwardInput> = {}): HomeAwardInput {
  return {
    id: `award:${ref}`,
    issuerPubkey: ISSUER,
    definitionAddress: PRODUCT,
    holderPubkey: HOLDER_A,
    orderContextKey: `order:${ref}`,
    createdAt: NOW - elapsedSeconds,
    ...overrides,
  };
}

function memberAward(overrides: Partial<HomeAwardInput>): HomeAwardInput {
  const awardId = id();
  return {
    id: awardId,
    issuerPubkey: ISSUER,
    definitionAddress: MEMBERSHIP,
    holderPubkey: HOLDER_A,
    orderContextKey: `order:${awardId}`,
    createdAt: NOW - 5000,
    ...overrides,
  };
}

function orderStatus(
  ref: string,
  status: PublishedOrderStatus,
  createdAt: number,
  overrides: Partial<HomeStatusInput> = {},
): HomeStatusInput {
  return {
    id: id(),
    signerPubkey: ADMIN,
    awardId: `award:${ref}`,
    definitionAddress: PRODUCT,
    holderPubkey: HOLDER_A,
    contextKey: `order:${ref}`,
    contextType: "order",
    status,
    createdAt,
    ...overrides,
  };
}

function calendarEvent(overrides: Partial<HomeCalendarEventInput>): HomeCalendarEventInput {
  return {
    id: id(),
    authorPubkey: ADMIN,
    d: `event-${counter}`,
    startsAt: NOW + 7200,
    createdAt: NOW - 1000,
    ...overrides,
  };
}

function profile(overrides: Partial<HomeProfileInput>): HomeProfileInput {
  return {
    id: id(),
    authorPubkey: ADMIN,
    d: "nuts-community-profile",
    name: "Maison Crays",
    createdAt: NOW - 9000,
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    profiles: [profile({})],
    definitions: [productDefinition({ address: PRODUCT })],
    awards: [],
    statuses: [],
    calendarEvents: [],
    deletions: [],
    trust: TRUST,
    now: NOW,
    ...overrides,
  };
}

describe("projectHomeSummary", () => {
  it("counts open orders by stage with the oldest wait, excluding terminal orders", () => {
    const summary = projectHomeSummary(
      baseInput({
        awards: [
          orderAward("p1", 300),
          orderAward("p2", 120),
          orderAward("a1", 600),
          orderAward("pr1", 60),
          orderAward("r1", 30),
          orderAward("f1", 900),
          orderAward("c1", 900),
        ],
        statuses: [
          orderStatus("a1", "accepted", NOW - 500),
          orderStatus("pr1", "accepted", NOW - 59),
          orderStatus("pr1", "processing", NOW - 50),
          orderStatus("r1", "accepted", NOW - 29),
          orderStatus("r1", "ready", NOW - 20),
          orderStatus("f1", "accepted", NOW - 800),
          orderStatus("f1", "fulfilled", NOW - 700),
          orderStatus("c1", "cancelled", NOW - 800),
        ],
      }),
    );
    expect(summary.orders).toEqual({
      open: 5,
      byStage: { pending: 2, accepted: 1, processing: 1, ready: 1 },
      oldestWaitSeconds: 600,
    });
  });

  it("reports zero open orders and zero wait for an empty queue", () => {
    const summary = projectHomeSummary(baseInput());
    expect(summary.orders).toEqual({
      open: 0,
      byStage: { pending: 0, accepted: 0, processing: 0, ready: 0 },
      oldestWaitSeconds: 0,
    });
  });

  it("groups awards sharing an order ref into a single order", () => {
    const summary = projectHomeSummary(
      baseInput({
        awards: [orderAward("shared", 300), orderAward("shared", 200)],
      }),
    );
    expect(summary.orders.open).toBe(1);
    expect(summary.orders.byStage.pending).toBe(1);
    expect(summary.orders.oldestWaitSeconds).toBe(300);
  });

  it("ignores statuses from invalid signers and from event contexts", () => {
    const summary = projectHomeSummary(
      baseInput({
        awards: [orderAward("a", 300)],
        statuses: [
          orderStatus("a", "accepted", NOW - 100, { signerPubkey: STRANGER }),
          orderStatus("a", "fulfilled", NOW - 50, {
            contextType: "event",
            contextKey: `event:31923:${ADMIN}:supper`,
          }),
        ],
      }),
    );
    expect(summary.orders.byStage).toEqual({ pending: 1, accepted: 0, processing: 0, ready: 0 });
  });

  it("ignores statuses with the wrong award, definition, holder, or causal timestamp", () => {
    const summary = projectHomeSummary(
      baseInput({
        awards: [orderAward("a", 300)],
        statuses: [
          orderStatus("a", "accepted", NOW - 100, { awardId: "another" }),
          orderStatus("a", "processing", NOW - 90, {
            definitionAddress: `30402:${ADMIN}:other`,
          }),
          orderStatus("a", "ready", NOW - 80, { holderPubkey: STRANGER }),
          orderStatus("a", "fulfilled", NOW - 301),
        ],
      }),
    );
    expect(summary.orders.byStage).toEqual({ pending: 1, accepted: 0, processing: 0, ready: 0 });
  });

  it("excludes revoked purchase awards from the open-order summary", () => {
    const purchase = orderAward("a", 300);
    const summary = projectHomeSummary(
      baseInput({
        awards: [purchase],
        deletions: [{ id: id(), authorPubkey: ADMIN, references: [purchase.id], createdAt: NOW }],
      }),
    );
    expect(summary.orders.open).toBe(0);
  });

  it("accepts current statuses from a live 37237/write role holder", () => {
    const roleAddress = `30009:${ADMIN}:fulfillment`;
    const purchase = orderAward("a", 300);
    const roleAward = orderAward("role", 200, {
      issuerPubkey: ADMIN,
      definitionAddress: roleAddress,
      holderPubkey: STRANGER,
    });
    const summary = projectHomeSummary(
      baseInput({
        definitions: [
          productDefinition({ address: PRODUCT }),
          {
            address: roleAddress,
            id: id(),
            authorPubkey: ADMIN,
            type: "role",
            sellable: false,
            permissions: [{ capability: "37237", access: "write" }],
            createdAt: NOW - 1000,
          },
        ],
        awards: [purchase, roleAward],
        statuses: [orderStatus("a", "accepted", NOW - 100, { signerPubkey: STRANGER })],
      }),
    );
    expect(summary.orders.byStage).toEqual({ pending: 0, accepted: 1, processing: 0, ready: 0 });
  });

  it("resolves the latest status per context by created_at, lowest id breaking ties", () => {
    const summary = projectHomeSummary(
      baseInput({
        awards: [orderAward("a", 900), orderAward("b", 900)],
        statuses: [
          orderStatus("a", "accepted", NOW - 100, { id: "9".repeat(64) }),
          orderStatus("a", "processing", NOW - 100, { id: "1".repeat(64) }),
          orderStatus("b", "processing", NOW - 200, { id: "1".repeat(64) }),
          orderStatus("b", "accepted", NOW - 100, { id: "9".repeat(64) }),
        ],
      }),
    );
    expect(summary.orders.byStage).toEqual({ pending: 0, accepted: 1, processing: 1, ready: 0 });
  });

  it("counts only valid awards of sellable product definitions", () => {
    const summary = projectHomeSummary(
      baseInput({
        definitions: [
          productDefinition({ address: PRODUCT }),
          productDefinition({ address: `30402:${ADMIN}:free`, sellable: false }),
          membershipDefinition(MEMBERSHIP),
        ],
        awards: [
          orderAward("ok", 100),
          orderAward("unknown-def", 100, { definitionAddress: `30402:${ADMIN}:ghost` }),
          orderAward("badge-issuer-unpriced", 100, { definitionAddress: `30402:${ADMIN}:free` }),
          orderAward("admin-unpriced", 100, { definitionAddress: `30402:${ADMIN}:free`, issuerPubkey: ADMIN }),
          orderAward("membership-purchase", 100, { definitionAddress: MEMBERSHIP }),
        ],
      }),
    );
    expect(summary.orders.open).toBe(1);
    expect(summary.orders.byStage.pending).toBe(1);
  });

  it("counts only trusted sellable product listings marked unavailable", () => {
    const summary = projectHomeSummary(
      baseInput({
        definitions: [
          productDefinition({ address: `30402:${ADMIN}:a`, availability: "unavailable" }),
          productDefinition({ address: `30402:${ADMIN}:b`, availability: "unavailable" }),
          productDefinition({ address: `30402:${ADMIN}:c`, availability: "available" }),
          productDefinition({ address: `30402:${ADMIN}:d`, availability: "archived" }),
          productDefinition({ address: `30402:${ADMIN}:p`, type: "pass", availability: "unavailable" }),
          productDefinition({ address: `30402:${ADMIN}:t`, type: "event_access", availability: "unavailable" }),
          productDefinition({ address: `30402:${ADMIN}:x`, sellable: false, availability: "unavailable" }),
          membershipDefinition(`30009:${ROOT}:membership`, { availability: "unavailable" }),
          productDefinition({ address: `30402:${STRANGER}:s`, authorPubkey: STRANGER, availability: "unavailable" }),
        ],
      }),
    );
    expect(summary.unavailableMenuCount).toBe(2);
  });

  it("resolves unavailable state from the latest addressable definition", () => {
    const address = `30402:${ADMIN}:item`;
    const older = productDefinition({ address, availability: "unavailable", createdAt: NOW - 2000, id: "1".repeat(64) });
    const newer = productDefinition({ address, availability: "available", createdAt: NOW - 100, id: "2".repeat(64) });
    const summary = projectHomeSummary(baseInput({ definitions: [older, newer] }));
    expect(summary.unavailableMenuCount).toBe(0);
  });

  it("picks the earliest upcoming trusted event and ignores past or untrusted ones", () => {
    const summary = projectHomeSummary(
      baseInput({
        calendarEvents: [
          calendarEvent({ startsAt: NOW + 7200, title: "Late supper" }),
          calendarEvent({ startsAt: NOW + 3600, title: "Early supper" }),
          calendarEvent({ startsAt: NOW - 3600, title: "Yesterday" }),
          calendarEvent({ startsAt: NOW + 1800, authorPubkey: STRANGER, title: "Forged" }),
        ],
      }),
    );
    expect(summary.nextEvent?.title).toBe("Early supper");
    expect(summary.nextEvent?.happeningNow).toBe(false);
  });

  it("counts events authored by the community root key", () => {
    const summary = projectHomeSummary(
      baseInput({
        calendarEvents: [calendarEvent({ startsAt: NOW + 900, authorPubkey: ROOT, title: "Root event" })],
      }),
    );
    expect(summary.nextEvent?.title).toBe("Root event");
  });

  it("flags a started-but-not-ended event as happening now", () => {
    const summary = projectHomeSummary(
      baseInput({
        calendarEvents: [calendarEvent({ startsAt: NOW - 1800, endsAt: NOW + 1800, title: "Service" })],
      }),
    );
    expect(summary.nextEvent?.happeningNow).toBe(true);
  });

  it("resolves calendar events as latest per d tag", () => {
    const d = "supper";
    const older = calendarEvent({ d, startsAt: NOW + 3600, createdAt: NOW - 2000, id: "1".repeat(64) });
    const newer = calendarEvent({ d, startsAt: NOW + 5400, createdAt: NOW - 100, id: "2".repeat(64) });
    const summary = projectHomeSummary(baseInput({ calendarEvents: [older, newer] }));
    expect(summary.nextEvent?.startsAt).toBe(NOW + 5400);
  });

  it("counts distinct active members and those expiring within 30 days, resolving the root-authored invite definition", () => {
    const summary = projectHomeSummary(
      baseInput({
        definitions: [membershipDefinition(MEMBERSHIP)],
        awards: [
          memberAward({ definitionAddress: MEMBERSHIP, holderPubkey: HOLDER_A, expiresAt: NOW + 10 * 86400 }),
          memberAward({ definitionAddress: MEMBERSHIP, holderPubkey: HOLDER_B }), // no expiry
          memberAward({ definitionAddress: MEMBERSHIP, holderPubkey: HOLDER_A, expiresAt: NOW - 10 }), // expired
          memberAward({ definitionAddress: MEMBERSHIP, issuerPubkey: STRANGER, expiresAt: NOW + 5 * 86400 }), // untrusted
        ],
      }),
    );
    expect(summary.members).toEqual({ active: 2, expiringSoon: 1 });
  });

  it("excludes awards of membership definitions from untrusted authors", () => {
    const forged = `30009:${STRANGER}:membership`;
    const summary = projectHomeSummary(
      baseInput({
        definitions: [membershipDefinition(forged, { authorPubkey: STRANGER })],
        awards: [memberAward({ definitionAddress: forged, holderPubkey: HOLDER_A })],
      }),
    );
    expect(summary.members).toEqual({ active: 0, expiringSoon: 0 });
  });

  it("excludes membership awards revoked by an admin or the award's own issuer only", () => {
    const live = memberAward({ holderPubkey: HOLDER_A, expiresAt: NOW + 10 * 86400 });
    const revokedByAdmin = memberAward({ holderPubkey: HOLDER_B });
    const revokedByIssuer = memberAward({ holderPubkey: HOLDER_C });
    const summary = projectHomeSummary(
      baseInput({
        definitions: [membershipDefinition(MEMBERSHIP)],
        awards: [live, revokedByAdmin, revokedByIssuer],
        deletions: [
          { id: id(), authorPubkey: STRANGER, references: [live.id], createdAt: NOW },
          { id: id(), authorPubkey: ADMIN, references: [revokedByAdmin.id], createdAt: NOW },
          { id: id(), authorPubkey: ISSUER, references: [revokedByIssuer.id], createdAt: NOW },
        ],
      }),
    );
    expect(summary.members).toEqual({ active: 1, expiringSoon: 1 });
  });

  it("derives the venue name from the latest trusted hospitality profile", () => {
    const summary = projectHomeSummary(
      baseInput({
        profiles: [
          profile({ name: "Old name", createdAt: NOW - 9000, id: "1".repeat(64) }),
          profile({ name: "Maison Crays", createdAt: NOW - 100, id: "2".repeat(64) }),
          profile({ name: "Forged", authorPubkey: STRANGER, createdAt: NOW, id: "3".repeat(64) }),
        ],
      }),
    );
    expect(summary.venueName).toBe("Maison Crays");
  });

  it("marks a venue with menu truth as established (no checklist)", () => {
    const summary = projectHomeSummary(baseInput());
    expect(summary.isNewVenue).toBe(false);
    expect(summary.checklist.menuDone).toBe(true);
  });

  it("marks a venue without menu, events, or members as new (checklist variant)", () => {
    const summary = projectHomeSummary(
      baseInput({ definitions: [], profiles: [], awards: [], statuses: [], calendarEvents: [] }),
    );
    expect(summary.isNewVenue).toBe(true);
    expect(summary.checklist).toEqual({ menuDone: false, eventsDone: false, membersDone: false });
  });
});

describe("homeMarkerPayload", () => {
  it("serializes the projected counts without secrets", () => {
    const summary = projectHomeSummary(
      baseInput({
        awards: [orderAward("p1", 300), orderAward("a1", 600)],
        statuses: [orderStatus("a1", "accepted", NOW - 500)],
        calendarEvents: [calendarEvent({ startsAt: NOW + 3600 })],
      }),
    );
    const payload = homeMarkerPayload(summary, "wss://relay.example", true);
    expect(payload).toEqual({
      venue: "wss://relay.example",
      venueName: "Maison Crays",
      live: true,
      orders: { open: 2, pending: 1, accepted: 1, processing: 0, ready: 0 },
      oldestWaitSeconds: 600,
      unavailableMenu: 0,
      nextEvent: { id: summary.nextEvent?.id, startsAt: NOW + 3600 },
      members: { active: 0, expiringSoon: 0 },
      checklist: false,
    });
    expect(JSON.stringify(payload)).not.toContain("nsec");
  });

  it("serializes a null nextEvent for a venue without upcoming events", () => {
    const summary = projectHomeSummary(baseInput());
    const payload = homeMarkerPayload(summary, "wss://relay.example", false);
    expect(payload.nextEvent).toBeNull();
    expect(payload.live).toBe(false);
  });
});
