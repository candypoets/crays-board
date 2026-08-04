/// <reference types="jest" />

import {
  EXPIRING_SOON_SECONDS,
  PERMISSIONS,
  ROLE_LIMIT,
  latestDefinitions,
  projectPeople,
  projectRoles,
  type PeopleAwardInput,
  type PeopleDefinitionInput,
  type PeopleProjectionInput,
} from "@/people/fold";

const ADMIN = "a".repeat(64);
const ISSUER = "e".repeat(64);
const USER_A = "b".repeat(64);
const USER_B = "c".repeat(64);
const USER_C = "d".repeat(64);
const NOW = 1_800_000_000;

const roleDef: PeopleDefinitionInput = {
  address: `30009:${ADMIN}:qa-role`,
  authorPubkey: ADMIN,
  d: "qa-role",
  id: "f".repeat(64),
  createdAt: NOW - 1000,
  name: "Events host",
  type: "role",
  permissions: ["events", "invites"],
};

const membershipDef: PeopleDefinitionInput = {
  address: `30009:${ADMIN}:qa-membership`,
  authorPubkey: ADMIN,
  d: "qa-membership",
  id: "1".repeat(64),
  createdAt: NOW - 1000,
  name: "Membership",
  type: "membership",
  permissions: [],
};

let awardSeq = 0;
function award(overrides: Partial<PeopleAwardInput>): PeopleAwardInput {
  awardSeq += 1;
  return {
    id: awardSeq.toString(16).padStart(64, "0"),
    issuerPubkey: ISSUER,
    definitionAddress: membershipDef.address,
    holderPubkey: USER_A,
    createdAt: NOW - 100,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PeopleProjectionInput>): PeopleProjectionInput {
  return {
    awards: [],
    definitions: [roleDef, membershipDef],
    revocations: [],
    profiles: [],
    authorities: new Set([ADMIN]),
    trustedIssuers: new Set([ADMIN, ISSUER]),
    now: NOW,
    ...overrides,
  };
}

describe("constants", () => {
  it("keeps the PRD §8.7 contract values", () => {
    expect(PERMISSIONS).toEqual(["posts", "media", "events", "store", "invites", "moderation", "settings"]);
    expect(EXPIRING_SOON_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(ROLE_LIMIT).toBe(4);
  });
});

describe("projectPeople", () => {
  it("lists root admins as active even with no awards", () => {
    const people = projectPeople(baseInput({}));
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ pubkey: ADMIN, isRootAdmin: true, status: "active" });
  });

  it("derives Active, Expiring soon, and Expired from award expiry (PEOPLE-02)", () => {
    const people = projectPeople(
      baseInput({
        awards: [
          award({ holderPubkey: USER_A }), // no expiration → active
          award({ holderPubkey: USER_B, expiresAt: NOW + 10 * 24 * 60 * 60 }), // ≤30d → expiring
          award({ holderPubkey: USER_C, expiresAt: NOW - 60 }), // past → expired
        ],
      }),
    );
    const byPubkey = new Map(people.map((person) => [person.pubkey, person]));
    expect(byPubkey.get(USER_A)?.status).toBe("active");
    expect(byPubkey.get(USER_A)?.nearestExpiry).toBeUndefined();
    expect(byPubkey.get(USER_B)?.status).toBe("expiring");
    expect(byPubkey.get(USER_B)?.nearestExpiry).toBe(NOW + 10 * 24 * 60 * 60);
    expect(byPubkey.get(USER_C)?.status).toBe("expired");
  });

  it("shows nearest expiry across multiple active awards and dedupes the holder", () => {
    const people = projectPeople(
      baseInput({
        awards: [
          award({ holderPubkey: USER_A, expiresAt: NOW + 90 * 24 * 60 * 60 }),
          award({ holderPubkey: USER_A, definitionAddress: roleDef.address, expiresAt: NOW + 40 * 24 * 60 * 60 }),
        ],
      }),
    );
    const person = people.find((entry) => entry.pubkey === USER_A);
    expect(people.filter((entry) => entry.pubkey === USER_A)).toHaveLength(1);
    expect(person?.status).toBe("active"); // 40 days out is not expiring soon
    expect(person?.nearestExpiry).toBe(NOW + 40 * 24 * 60 * 60);
    expect(person?.permissions).toEqual(["events", "invites"]);
  });

  it("excludes untrusted issuers, unknown definitions, and unrelated definition types", () => {
    const productDef: PeopleDefinitionInput = { ...membershipDef, address: `30009:${ADMIN}:qa-item`, d: "qa-item", type: "food" };
    const people = projectPeople(
      baseInput({
        definitions: [roleDef, membershipDef, productDef],
        awards: [
          award({ holderPubkey: USER_A, issuerPubkey: USER_B }), // untrusted issuer
          award({ holderPubkey: USER_B, definitionAddress: `30009:${ADMIN}:missing` }), // no definition
          award({ holderPubkey: USER_C, definitionAddress: productDef.address }), // not role/membership
        ],
      }),
    );
    expect(people.map((person) => person.pubkey)).toEqual([ADMIN]);
  });

  it("a revoked award grants nothing and leaves the holder Expired (PEOPLE-01)", () => {
    const revoked = award({ holderPubkey: USER_A });
    const people = projectPeople(
      baseInput({
        awards: [revoked],
        revocations: [{ id: "2".repeat(64), authorPubkey: ADMIN, awardIds: [revoked.id], createdAt: NOW - 10 }],
      }),
    );
    const person = people.find((entry) => entry.pubkey === USER_A);
    expect(person?.status).toBe("expired");
    expect(person?.awards[0]).toMatchObject({ revoked: true, active: false });
    expect(person?.permissions).toEqual([]);
  });

  it("ignores revocations from untrusted signers", () => {
    const target = award({ holderPubkey: USER_A });
    const people = projectPeople(
      baseInput({
        awards: [target],
        revocations: [{ id: "2".repeat(64), authorPubkey: USER_C, awardIds: [target.id], createdAt: NOW - 10 }],
      }),
    );
    expect(people.find((entry) => entry.pubkey === USER_A)?.status).toBe("active");
  });

  it("uses venue-local kind 0 names and falls back to a shortened key", () => {
    const people = projectPeople(
      baseInput({
        awards: [award({ holderPubkey: USER_A })],
        profiles: [
          { pubkey: USER_A, name: "QA Active Member", createdAt: NOW - 50 },
          { pubkey: USER_A, name: "  ", createdAt: NOW - 40 },
        ],
      }),
    );
    const named = people.find((entry) => entry.pubkey === USER_A);
    // The newer blank name wins by recency but falls back to the key fragment.
    expect(named?.displayName).toBe(`${USER_A.slice(0, 12)}…`);
    expect(people.find((entry) => entry.pubkey === ADMIN)?.displayName).toBe(`${ADMIN.slice(0, 12)}…`);
  });
});

describe("latestDefinitions", () => {
  it("resolves the latest per address with id tie-break", () => {
    const older: PeopleDefinitionInput = { ...roleDef, id: "a".repeat(64), createdAt: NOW - 5, name: "Old" };
    const newer: PeopleDefinitionInput = { ...roleDef, id: "b".repeat(64), createdAt: NOW - 5, name: "New" };
    const latest = latestDefinitions([older, newer]);
    expect(latest.get(roleDef.address)?.name).toBe("New");
  });
});

describe("projectRoles", () => {
  it("lists trusted role definitions with canonical permission order", () => {
    const shuffled: PeopleDefinitionInput = { ...roleDef, permissions: ["invites", "events"] };
    const roles = projectRoles({
      definitions: [shuffled, membershipDef],
      trustedIssuers: new Set([ADMIN]),
      activePubkey: ADMIN.toUpperCase(),
    });
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      d: "qa-role",
      name: "Events host",
      permissions: ["events", "invites"],
      editable: true,
    });
  });

  it("drops untrusted authors and non-editable roles for other keys", () => {
    const foreign: PeopleDefinitionInput = { ...roleDef, address: `30009:${USER_C}:role`, authorPubkey: USER_C, d: "role" };
    const roles = projectRoles({
      definitions: [roleDef, foreign],
      trustedIssuers: new Set([ADMIN]),
      activePubkey: USER_A,
    });
    expect(roles).toHaveLength(1);
    expect(roles[0].editable).toBe(false);
  });
});
