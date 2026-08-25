/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";
import {
  projectCheckIn,
  selectActiveEvent,
  type CalendarEventRecord,
  type CheckInAwardRecord,
  type TicketDefinitionRecord,
} from "@/check-in/fold";
import type { CheckInStatus } from "@/check-in/presentation";

const ROOT = "0".repeat(64);
const ADMIN = "a".repeat(64);
const ISSUER = "b".repeat(64);
const STRANGER = "f".repeat(64);
const HOLDER = "c".repeat(64);
const EVENT_ADDRESS = `31923:${ADMIN}:supper-club`;
const OTHER_EVENT_ADDRESS = `31923:${ADMIN}:gala-night`;
const TICKET_ADDRESS = `30402:${ADMIN}:supper-ticket`;
const NOW = 1_700_000_000;

const TRUST: CommunityTrust = { rootPubkey: ROOT, admins: new Set([ADMIN]), badgeIssuer: ISSUER };

function event(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    address: EVENT_ADDRESS,
    authorPubkey: ADMIN,
    title: "Supper club",
    start: NOW + 3600,
    createdAt: NOW - 100,
    ...overrides,
  };
}

function definition(overrides: Partial<TicketDefinitionRecord> = {}): TicketDefinitionRecord {
  return {
    address: TICKET_ADDRESS,
    authorPubkey: ADMIN,
    eventAddress: EVENT_ADDRESS,
    sellable: true,
    maxUses: 1,
    createdAt: NOW - 90,
    ...overrides,
  };
}

function award(idSuffix: string, overrides: Partial<CheckInAwardRecord> = {}): CheckInAwardRecord {
  return {
    id: idSuffix.repeat(64),
    issuerPubkey: ISSUER,
    definitionAddress: TICKET_ADDRESS,
    holderPubkey: HOLDER,
    createdAt: NOW - 50,
    ...overrides,
  };
}

let statusSeq = 0;
function makeStatus(overrides: Partial<CheckInStatus> = {}): CheckInStatus {
  statusSeq += 1;
  return {
    id: statusSeq.toString(16).padStart(64, "0"),
    awardId: "1".repeat(64),
    definitionAddress: TICKET_ADDRESS,
    holderPubkey: HOLDER,
    signerPubkey: ADMIN,
    contextKey: `event:${EVENT_ADDRESS}`,
    status: "fulfilled",
    createdAt: NOW - 10,
    ...overrides,
  };
}

describe("selectActiveEvent", () => {
  it("picks the nearest upcoming event by start time", () => {
    const soon = event({ address: `31923:${ADMIN}:soon`, start: NOW + 600 });
    const later = event({ address: `31923:${ADMIN}:later`, start: NOW + 7200 });
    const past = event({ address: `31923:${ADMIN}:past`, start: NOW - 7200 });
    expect(selectActiveEvent([later, past, soon], NOW)?.address).toBe(soon.address);
  });

  it("falls back to the most recently published event when nothing is upcoming", () => {
    const older = event({ address: `31923:${ADMIN}:older`, start: NOW - 7200, createdAt: NOW - 200 });
    const newer = event({ address: `31923:${ADMIN}:newer`, start: undefined, createdAt: NOW - 100 });
    expect(selectActiveEvent([older, newer], NOW)?.address).toBe(newer.address);
  });

  it("returns undefined with no events", () => {
    expect(selectActiveEvent([], NOW)).toBeUndefined();
  });
});

describe("projectCheckIn", () => {
  const active = event();
  const definitions = new Map([[TICKET_ADDRESS, definition()]]);

  function project(overrides: {
    awards?: CheckInAwardRecord[];
    definitions?: ReadonlyMap<string, TicketDefinitionRecord>;
    statuses?: CheckInStatus[];
    revocations?: { authorPubkey: string; references: string[] }[];
  }) {
    return projectCheckIn({
      event: active,
      awards: overrides.awards ?? [],
      definitions: overrides.definitions ?? definitions,
      statuses: overrides.statuses ?? [],
      revocations: overrides.revocations ?? [],
      trust: TRUST,
      now: NOW,
    });
  }

  it("counts ticket awards as expected and fulfilled ones as checked in", () => {
    const projection = project({
      awards: [award("1"), award("2"), award("3")],
      statuses: [
        makeStatus({ awardId: "1".repeat(64) }),
        makeStatus({ awardId: "2".repeat(64) }),
      ],
    });
    expect(projection).toEqual({ expected: 3, checkedIn: 2 });
  });

  it("counts direct free-admission awards granted by an admin", () => {
    const direct = award("1", { definitionAddress: EVENT_ADDRESS, issuerPubkey: ADMIN });
    expect(project({ awards: [direct] })).toEqual({ expected: 1, checkedIn: 0 });
  });

  it("excludes direct awards signed by the badge issuer (non-sellable definition)", () => {
    const direct = award("1", { definitionAddress: EVENT_ADDRESS, issuerPubkey: ISSUER });
    expect(project({ awards: [direct] })).toEqual({ expected: 0, checkedIn: 0 });
  });

  it("applies issuance rules: the badge issuer needs a sellable definition", () => {
    const nonSellable = new Map([[TICKET_ADDRESS, definition({ sellable: false })]]);
    expect(project({ awards: [award("1")], definitions: nonSellable })).toEqual({ expected: 0, checkedIn: 0 });
    expect(
      project({ awards: [award("1", { issuerPubkey: ADMIN })], definitions: nonSellable }),
    ).toEqual({ expected: 1, checkedIn: 0 });
    expect(project({ awards: [award("1", { issuerPubkey: STRANGER })] })).toEqual({ expected: 0, checkedIn: 0 });
  });

  it("requires a trusted ticket definition author", () => {
    const foreign = new Map([[TICKET_ADDRESS, definition({ authorPubkey: STRANGER })]]);
    expect(project({ awards: [award("1")], definitions: foreign })).toEqual({ expected: 0, checkedIn: 0 });
    // The relay root authors definitions with the root key itself.
    const rooted = new Map([[TICKET_ADDRESS, definition({ authorPubkey: ROOT })]]);
    expect(project({ awards: [award("1")], definitions: rooted })).toEqual({ expected: 1, checkedIn: 0 });
  });

  it("excludes awards whose ticket definition points at another event", () => {
    const elsewhere = new Map([[TICKET_ADDRESS, definition({ eventAddress: OTHER_EVENT_ADDRESS })]]);
    expect(project({ awards: [award("1")], definitions: elsewhere })).toEqual({ expected: 0, checkedIn: 0 });
    expect(project({ awards: [award("1")], definitions: new Map() })).toEqual({ expected: 0, checkedIn: 0 });
  });

  it("excludes expired and revoked awards", () => {
    const projection = project({
      awards: [award("1", { expiresAt: NOW - 1 }), award("2")],
      revocations: [{ authorPubkey: ADMIN, references: ["2".repeat(64)] }],
    });
    expect(projection).toEqual({ expected: 0, checkedIn: 0 });
  });

  it("honors revocations by the award issuer but ignores untrusted ones", () => {
    const byIssuer = project({
      awards: [award("1")],
      revocations: [{ authorPubkey: ISSUER, references: ["1".repeat(64)] }],
    });
    expect(byIssuer.expected).toBe(0);

    const byStranger = project({
      awards: [award("1")],
      revocations: [{ authorPubkey: STRANGER, references: ["1".repeat(64)] }],
    });
    expect(byStranger.expected).toBe(1);
  });

  it("counts checked in only from the latest trusted status at the event context", () => {
    const projection = project({
      awards: [award("1"), award("2"), award("3"), award("4")],
      statuses: [
        // Award 1: fulfilled at another event — not checked in here.
        makeStatus({ awardId: "1".repeat(64), contextKey: `event:${OTHER_EVENT_ADDRESS}` }),
        // Award 2: fulfilled then cancelled at this event — not checked in.
        makeStatus({ awardId: "2".repeat(64), id: "1".repeat(64), createdAt: NOW - 20, status: "fulfilled" }),
        makeStatus({ awardId: "2".repeat(64), id: "2".repeat(64), createdAt: NOW - 10, status: "cancelled" }),
        // Award 3: fulfilled by an untrusted signer — not checked in.
        makeStatus({ awardId: "3".repeat(64), signerPubkey: STRANGER }),
        // Award 4: fulfilled here by an admin — checked in.
        makeStatus({ awardId: "4".repeat(64) }),
      ],
    });
    expect(projection).toEqual({ expected: 4, checkedIn: 1 });
  });

  it("does not count a status with the wrong definition or holder binding", () => {
    const projection = project({
      awards: [award("1")],
      statuses: [
        makeStatus({ definitionAddress: `30402:${ADMIN}:other` }),
        makeStatus({ holderPubkey: STRANGER }),
      ],
    });
    expect(projection).toEqual({ expected: 1, checkedIn: 0 });
  });
});
