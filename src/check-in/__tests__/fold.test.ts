/// <reference types="jest" />

import {
  projectCheckIn,
  selectActiveEvent,
  type CalendarEventRecord,
  type CheckInAwardRecord,
} from "@/check-in/fold";

const ADMIN = "a".repeat(64);
const ISSUER = "b".repeat(64);
const STRANGER = "f".repeat(64);
const HOLDER = "c".repeat(64);
const ACCESS_ADDRESS = `30009:${ADMIN}:qa-event-access`;
const NOW = 1_700_000_000;

const TRUSTED = new Set([ADMIN, ISSUER]);

function event(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: "1".repeat(64),
    title: "Supper club",
    start: NOW + 3600,
    accessAddress: ACCESS_ADDRESS,
    createdAt: NOW - 100,
    ...overrides,
  };
}

function award(idSuffix: string, overrides: Partial<CheckInAwardRecord> = {}): CheckInAwardRecord {
  return {
    id: idSuffix.repeat(64),
    issuerPubkey: ISSUER,
    definitionAddress: ACCESS_ADDRESS,
    holderPubkey: HOLDER,
    createdAt: NOW - 50,
    ...overrides,
  };
}

describe("selectActiveEvent", () => {
  it("picks the nearest upcoming event by start time", () => {
    const soon = event({ id: "1".repeat(64), start: NOW + 600 });
    const later = event({ id: "2".repeat(64), start: NOW + 7200 });
    const past = event({ id: "3".repeat(64), start: NOW - 7200 });
    expect(selectActiveEvent([later, past, soon], NOW)?.id).toBe(soon.id);
  });

  it("falls back to the most recently published event when nothing is upcoming", () => {
    const older = event({ id: "1".repeat(64), start: NOW - 7200, createdAt: NOW - 200 });
    const newer = event({ id: "2".repeat(64), start: undefined, createdAt: NOW - 100 });
    expect(selectActiveEvent([older, newer], NOW)?.id).toBe(newer.id);
  });

  it("returns undefined with no events", () => {
    expect(selectActiveEvent([], NOW)).toBeUndefined();
  });
});

describe("projectCheckIn", () => {
  const active = event();

  it("counts trusted awards as expected and fulfilled ones as checked in", () => {
    const projection = projectCheckIn({
      event: active,
      awards: [award("1"), award("2"), award("3")],
      statuses: [
        { authorPubkey: ADMIN, contextKey: "1".repeat(64), status: "fulfilled", context: "event" },
        { authorPubkey: ADMIN, contextKey: "2".repeat(64), status: "fulfilled", context: "event" },
      ],
      revocations: [],
      trustedIssuers: TRUSTED,
      now: NOW,
    });
    expect(projection).toEqual({ expected: 3, checkedIn: 2 });
  });

  it("excludes untrusted issuers and their fulfillments", () => {
    const projection = projectCheckIn({
      event: active,
      awards: [award("1", { issuerPubkey: STRANGER })],
      statuses: [
        { authorPubkey: STRANGER, contextKey: "1".repeat(64), status: "fulfilled", context: "event" },
      ],
      revocations: [],
      trustedIssuers: TRUSTED,
      now: NOW,
    });
    expect(projection).toEqual({ expected: 0, checkedIn: 0 });
  });

  it("excludes expired and revoked awards", () => {
    const projection = projectCheckIn({
      event: active,
      awards: [award("1", { expiresAt: NOW - 1 }), award("2")],
      statuses: [],
      revocations: [{ authorPubkey: ADMIN, references: ["2".repeat(64)] }],
      trustedIssuers: TRUSTED,
      now: NOW,
    });
    expect(projection).toEqual({ expected: 0, checkedIn: 0 });
  });

  it("ignores an untrusted revocation", () => {
    const projection = projectCheckIn({
      event: active,
      awards: [award("1")],
      statuses: [],
      revocations: [{ authorPubkey: STRANGER, references: ["1".repeat(64)] }],
      trustedIssuers: TRUSTED,
      now: NOW,
    });
    expect(projection.expected).toBe(1);
  });

  it("excludes awards for other definitions and order-context fulfillments", () => {
    const projection = projectCheckIn({
      event: active,
      awards: [award("1"), award("2", { definitionAddress: `30009:${ADMIN}:drink` })],
      statuses: [
        { authorPubkey: ADMIN, contextKey: "1".repeat(64), status: "fulfilled", context: "order" },
      ],
      revocations: [],
      trustedIssuers: TRUSTED,
      now: NOW,
    });
    expect(projection).toEqual({ expected: 1, checkedIn: 0 });
  });
});
