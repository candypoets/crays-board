/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";
import { filterEvents, projectEvents, type CalendarEventInput, type RsvpInput } from "@/events/fold";

const ADMIN = "a".repeat(64);
const ROOT = "d".repeat(64);
const STRANGER = "f".repeat(64);
const GUEST_A = "b".repeat(64);
const GUEST_B = "c".repeat(64);
const NOW = 1_000_000;
const FUTURE = NOW + 86_400;
const PAST = NOW - 86_400;

/** NIP-97 trust: anchor admins plus the community root key. */
const TRUST: CommunityTrust = { rootPubkey: ROOT, admins: new Set([ADMIN]) };

function event(idSuffix: string, overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    id: idSuffix.padStart(64, "0"),
    pubkey: ADMIN,
    identifier: "qa-event",
    title: "QA Seed Event",
    start: FUTURE,
    end: FUTURE + 3600,
    createdAt: 100,
    ...overrides,
  };
}

function rsvp(
  idSuffix: string,
  attendee: string,
  status: RsvpInput["status"],
  createdAt: number,
  overrides: Partial<RsvpInput> = {},
): RsvpInput {
  return {
    id: idSuffix.padStart(64, "0"),
    attendeePubkey: attendee,
    eventAddress: `31923:${ADMIN}:qa-event`,
    status,
    createdAt,
    ...overrides,
  };
}

function project(input: {
  events?: CalendarEventInput[];
  rsvps?: RsvpInput[];
  trust?: CommunityTrust;
  now?: number;
}) {
  return projectEvents({
    events: input.events ?? [event("1")],
    rsvps: input.rsvps ?? [],
    trust: input.trust ?? TRUST,
    now: input.now ?? NOW,
  });
}

describe("event projection fold", () => {
  it("projects a trusted calendar event with zero RSVPs", () => {
    const [entry] = project({});
    expect(entry.title).toBe("QA Seed Event");
    expect(entry.address).toBe(`31923:${ADMIN}:qa-event`);
    expect(entry.rsvps).toEqual({ accepted: 0, tentative: 0, declined: 0 });
    expect(entry.isPast).toBe(false);
  });

  it("resolves an addressable event as the latest per author and d tag", () => {
    const [entry] = project({
      events: [
        event("1", { title: "Old title", createdAt: 100 }),
        event("2", { title: "New title", createdAt: 200 }),
      ],
    });
    expect(entry.title).toBe("New title");
  });

  it("breaks addressable ties by higher event id", () => {
    const [entry] = project({
      events: [event("1", { title: "Lower id", createdAt: 100 }), event("9", { title: "Higher id", createdAt: 100 })],
    });
    expect(entry.title).toBe("Higher id");
  });

  it("excludes events from untrusted authors", () => {
    expect(project({ events: [event("1", { pubkey: STRANGER })] })).toHaveLength(0);
  });

  it("counts events authored by the community root key", () => {
    expect(project({ events: [event("1", { pubkey: ROOT })] })).toHaveLength(1);
  });

  it("skips malformed events missing a title or a usable start", () => {
    expect(project({ events: [event("1", { title: undefined })] })).toHaveLength(0);
    expect(project({ events: [event("1", { start: 0 })] })).toHaveLength(0);
    expect(project({ events: [event("1", { identifier: "" })] })).toHaveLength(0);
  });

  it("counts accepted, tentative, and declined RSVPs for the event", () => {
    const [entry] = project({
      rsvps: [rsvp("1", GUEST_A, "accepted", 100), rsvp("2", GUEST_B, "tentative", 100)],
    });
    expect(entry.rsvps).toEqual({ accepted: 1, tentative: 1, declined: 0 });
  });

  it("counts only the latest RSVP per attendee", () => {
    const [entry] = project({
      rsvps: [rsvp("1", GUEST_A, "declined", 100), rsvp("2", GUEST_A, "accepted", 200)],
    });
    expect(entry.rsvps).toEqual({ accepted: 1, tentative: 0, declined: 0 });
  });

  it("breaks RSVP ties by higher event id", () => {
    const [entry] = project({
      rsvps: [rsvp("1", GUEST_A, "declined", 100), rsvp("9", GUEST_A, "tentative", 100)],
    });
    expect(entry.rsvps).toEqual({ accepted: 0, tentative: 1, declined: 0 });
  });

  it("ignores RSVPs addressed to a different event", () => {
    const [entry] = project({
      rsvps: [rsvp("1", GUEST_A, "accepted", 100, { eventAddress: `31923:${ADMIN}:other-event` })],
    });
    expect(entry.rsvps).toEqual({ accepted: 0, tentative: 0, declined: 0 });
  });

  it("sorts upcoming events soonest-first, then past most-recent-first", () => {
    const entries = project({
      events: [
        event("1", { identifier: "later", start: FUTURE + 7200, end: FUTURE + 10800 }),
        event("2", { identifier: "sooner", start: FUTURE, end: FUTURE + 3600 }),
        event("3", { identifier: "old", start: PAST - 7200, end: PAST - 3600 }),
        event("4", { identifier: "recent", start: PAST, end: PAST + 3600 }),
      ],
    });
    expect(entries.map((entry) => entry.identifier)).toEqual(["sooner", "later", "recent", "old"]);
    expect(entries[0].isPast).toBe(false);
    expect(entries[2].isPast).toBe(true);
  });

  it("treats an event without an end tag as ending at its start", () => {
    const [entry] = project({ events: [event("1", { end: undefined })] });
    expect(entry.end).toBe(entry.start);
  });
});

describe("event tab and search filtering", () => {
  const upcoming = projectEvents({
    events: [event("1", { identifier: "up", title: "Listening room", summary: "Records and tea" })],
    rsvps: [],
    trust: TRUST,
    now: NOW,
  });
  const past = projectEvents({
    events: [event("2", { identifier: "down", title: "Fermentation table", start: PAST, end: PAST + 3600 })],
    rsvps: [],
    trust: TRUST,
    now: NOW,
  });
  const all = [...upcoming, ...past];

  it("filters upcoming and past tabs", () => {
    expect(filterEvents(all, "upcoming", "").map((entry) => entry.identifier)).toEqual(["up"]);
    expect(filterEvents(all, "past", "").map((entry) => entry.identifier)).toEqual(["down"]);
    expect(filterEvents(all, "all", "")).toHaveLength(2);
  });

  it("matches search against title and summary, case-insensitively", () => {
    expect(filterEvents(all, "all", "listening").map((entry) => entry.identifier)).toEqual(["up"]);
    expect(filterEvents(all, "all", "RECORDS").map((entry) => entry.identifier)).toEqual(["up"]);
    expect(filterEvents(all, "all", "no match")).toHaveLength(0);
  });
});
