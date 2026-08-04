/// <reference types="jest" />

import type { BoardOrder } from "@/orders/fold";

import {
  homeMarkerPayload,
  projectHomeSummary,
  type HomeAwardInput,
  type HomeCalendarEventInput,
  type HomeDefinitionInput,
  type HomeProfileInput,
} from "../summary";

const NOW = 1_800_000_000;
const ADMIN = "a".repeat(64);
const ISSUER = "b".repeat(64);
const STRANGER = "c".repeat(64);
const HOLDER_A = "d".repeat(64);
const HOLDER_B = "e".repeat(64);
const TRUSTED = new Set([ADMIN, ISSUER]);

let counter = 0;
function id(): string {
  counter += 1;
  return counter.toString(16).padStart(64, "0");
}

function order(status: BoardOrder["status"], elapsedSeconds: number): BoardOrder {
  return {
    awardId: id(),
    definitionAddress: `30009:${ADMIN}:item`,
    holderPubkey: HOLDER_A,
    status,
    declined: false,
    createdAt: NOW - elapsedSeconds,
    updatedAt: NOW - elapsedSeconds,
    elapsedSeconds,
  };
}

function definition(overrides: Partial<HomeDefinitionInput> & { address: string }): HomeDefinitionInput {
  return { id: id(), sellable: true, type: "food", createdAt: NOW - 1000, ...overrides };
}

function award(overrides: Partial<HomeAwardInput>): HomeAwardInput {
  return {
    id: id(),
    issuerPubkey: ISSUER,
    definitionAddress: `30009:${ADMIN}:membership`,
    holderPubkey: HOLDER_A,
    createdAt: NOW - 5000,
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
    orders: [],
    profiles: [profile({})],
    definitions: [definition({ address: `30009:${ADMIN}:item` })],
    awards: [],
    calendarEvents: [],
    deletions: [],
    trustedIssuers: TRUSTED,
    now: NOW,
    ...overrides,
  };
}

describe("projectHomeSummary", () => {
  it("counts open orders by stage with the oldest wait, excluding terminal orders", () => {
    const summary = projectHomeSummary(
      baseInput({
        orders: [
          order("pending", 300),
          order("pending", 120),
          order("accepted", 600),
          order("processing", 60),
          order("ready", 30),
          order("fulfilled", 900),
          order("cancelled", 900),
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

  it("counts only sellable product definitions marked unavailable", () => {
    const summary = projectHomeSummary(
      baseInput({
        definitions: [
          definition({ address: `30009:${ADMIN}:a`, availability: "unavailable" }),
          definition({ address: `30009:${ADMIN}:b`, availability: "unavailable" }),
          definition({ address: `30009:${ADMIN}:c`, availability: "available" }),
          definition({ address: `30009:${ADMIN}:d`, availability: "archived" }),
          definition({ address: `30009:${ADMIN}:m`, type: "membership", availability: "unavailable" }),
          definition({ address: `30009:${ADMIN}:x`, sellable: false, availability: "unavailable" }),
        ],
      }),
    );
    expect(summary.unavailableMenuCount).toBe(2);
  });

  it("resolves unavailable state from the latest addressable definition", () => {
    const address = `30009:${ADMIN}:item`;
    const older = definition({ address, availability: "unavailable", createdAt: NOW - 2000, id: "1".repeat(64) });
    const newer = definition({ address, availability: "available", createdAt: NOW - 100, id: "2".repeat(64) });
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

  it("counts distinct active members and those expiring within 30 days", () => {
    const membership = `30009:${ADMIN}:membership`;
    const summary = projectHomeSummary(
      baseInput({
        definitions: [definition({ address: membership, type: "membership" })],
        awards: [
          award({ definitionAddress: membership, holderPubkey: HOLDER_A, expiresAt: NOW + 10 * 86400 }),
          award({ definitionAddress: membership, holderPubkey: HOLDER_B }), // no expiry
          award({ definitionAddress: membership, holderPubkey: HOLDER_A, expiresAt: NOW - 10 }), // expired
          award({ definitionAddress: membership, issuerPubkey: STRANGER, expiresAt: NOW + 5 * 86400 }), // untrusted
        ],
      }),
    );
    expect(summary.members).toEqual({ active: 2, expiringSoon: 1 });
  });

  it("excludes revoked membership awards via trusted kind-5 deletions", () => {
    const membership = `30009:${ADMIN}:membership`;
    const live = award({ definitionAddress: membership, holderPubkey: HOLDER_A, expiresAt: NOW + 10 * 86400 });
    const revokedAward = award({ definitionAddress: membership, holderPubkey: HOLDER_B });
    const summary = projectHomeSummary(
      baseInput({
        definitions: [definition({ address: membership, type: "membership" })],
        awards: [live, revokedAward],
        deletions: [
          { id: id(), authorPubkey: STRANGER, references: [live.id], createdAt: NOW },
          { id: id(), authorPubkey: ADMIN, references: [revokedAward.id], createdAt: NOW },
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
      baseInput({ definitions: [], profiles: [], orders: [], calendarEvents: [], awards: [] }),
    );
    expect(summary.isNewVenue).toBe(true);
    expect(summary.checklist).toEqual({ menuDone: false, eventsDone: false, membersDone: false });
  });
});

describe("homeMarkerPayload", () => {
  it("serializes the projected counts without secrets", () => {
    const summary = projectHomeSummary(
      baseInput({
        orders: [order("pending", 300), order("accepted", 600)],
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
