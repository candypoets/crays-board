/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";
import {
  EXPIRING_SOON_SECONDS,
  PERMISSIONS,
  ROLE_LIMIT,
  latestDefinitions,
  permissionsFromNip97,
  projectPeople,
  projectRoles,
  type PeopleAwardInput,
  type PeopleDefinitionInput,
  type PeopleProjectionInput,
} from "@/people/fold";

const ROOT = "9".repeat(64);
const ADMIN = "a".repeat(64);
const ISSUER = "e".repeat(64);
const USER_A = "b".repeat(64);
const USER_B = "c".repeat(64);
const USER_C = "d".repeat(64);
const USER_D = "7".repeat(64);
const USER_E = "8".repeat(64);
const NOW = 1_800_000_000;

/** NIP-97 trust: root key, one anchor admin, one delegated badge issuer. */
const trust: CommunityTrust = { rootPubkey: ROOT, admins: new Set([ADMIN]), badgeIssuer: ISSUER };

const roleDef: PeopleDefinitionInput = {
  address: `30009:${ADMIN}:qa-role`,
  authorPubkey: ADMIN,
  d: "qa-role",
  id: "f".repeat(64),
  createdAt: NOW - 1000,
  name: "Events host",
  type: "role",
  permissions: ["events", "invites"],
  sellable: false,
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
  sellable: false,
};

/** The node's root-authored, priced `members` invite definition. */
const inviteDef: PeopleDefinitionInput = {
  address: `30009:${ROOT}:members`,
  authorPubkey: ROOT,
  d: "members",
  id: "2".repeat(64),
  createdAt: NOW - 1000,
  name: "Member",
  type: "membership",
  permissions: [],
  sellable: true,
};

let awardSeq = 0;
function award(overrides: Partial<PeopleAwardInput>): PeopleAwardInput {
  awardSeq += 1;
  return {
    id: awardSeq.toString(16).padStart(64, "0"),
    issuerPubkey: ADMIN,
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
    trust,
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

describe("permissionsFromNip97", () => {
  it("maps NIP-97 grants back to matrix keys in canonical order", () => {
    expect(
      permissionsFromNip97([
        { capability: "settings" },
        { capability: "30402", access: "write" },
        { capability: "1", access: "write" },
      ]),
    ).toEqual(["posts", "store", "settings"]);
  });

  it("honors access markers and ignores unknown capabilities", () => {
    // A read-only grant does not confer the write-gated matrix key.
    expect(permissionsFromNip97([{ capability: "1", access: "read" }])).toEqual([]);
    // An unmarked grant covers both read and write.
    expect(permissionsFromNip97([{ capability: "1" }])).toEqual(["posts"]);
    // Unknown kinds and named capabilities never map onto the matrix.
    expect(permissionsFromNip97([{ capability: "9999", access: "write" }, { capability: "billing" }])).toEqual([]);
  });
});

describe("projectPeople", () => {
  it("lists the root key and anchor admins as active even with no awards", () => {
    const people = projectPeople(baseInput({}));
    expect(people).toHaveLength(2);
    const byPubkey = new Map(people.map((person) => [person.pubkey, person]));
    expect(byPubkey.get(ROOT)).toMatchObject({ isRootAdmin: true, status: "active" });
    expect(byPubkey.get(ADMIN)).toMatchObject({ isRootAdmin: true, status: "active" });
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

  it("applies the NIP-97 issuance and definition-trust rules (PEOPLE-01)", () => {
    const foreignDef: PeopleDefinitionInput = {
      ...membershipDef,
      address: `30009:${USER_C}:qa-membership`,
      authorPubkey: USER_C,
    };
    const unrelatedDef: PeopleDefinitionInput = {
      ...membershipDef,
      address: `30009:${ADMIN}:qa-item`,
      d: "qa-item",
      type: undefined,
    };
    const people = projectPeople(
      baseInput({
        definitions: [roleDef, membershipDef, inviteDef, foreignDef, unrelatedDef],
        awards: [
          // Badge-issuer invite award of the priced `members` def counts.
          award({ holderPubkey: USER_A, definitionAddress: inviteDef.address, issuerPubkey: ISSUER }),
          // Unpriced definitions require an anchor admin signer.
          award({ holderPubkey: USER_B, issuerPubkey: ISSUER }),
          // The definition must resolve on the venue relay.
          award({ holderPubkey: USER_C, definitionAddress: `30009:${ADMIN}:missing` }),
          // Definitions from untrusted authors never create a person.
          award({ holderPubkey: USER_D, definitionAddress: foreignDef.address }),
          // Definitions without a role/membership topic never create a person.
          award({ holderPubkey: USER_E, definitionAddress: unrelatedDef.address }),
        ],
      }),
    );
    expect(people.map((person) => person.pubkey).sort()).toEqual([ADMIN, ROOT, USER_A].sort());
    const invited = people.find((entry) => entry.pubkey === USER_A);
    expect(invited?.awards[0]).toMatchObject({ kind: "membership", name: "Member", active: true });
  });

  it("a revoked award grants nothing and leaves the holder Expired (PEOPLE-01)", () => {
    const revoked = award({ holderPubkey: USER_A });
    const people = projectPeople(
      baseInput({
        awards: [revoked],
        revocations: [{ id: "3".repeat(64), authorPubkey: ADMIN, awardIds: [revoked.id], createdAt: NOW - 10 }],
      }),
    );
    const person = people.find((entry) => entry.pubkey === USER_A);
    expect(person?.status).toBe("expired");
    expect(person?.awards[0]).toMatchObject({ revoked: true, active: false });
    expect(person?.permissions).toEqual([]);
  });

  it("counts a revocation from the award's own issuer", () => {
    const target = award({ holderPubkey: USER_A, definitionAddress: inviteDef.address, issuerPubkey: ISSUER });
    const people = projectPeople(
      baseInput({
        definitions: [roleDef, membershipDef, inviteDef],
        awards: [target],
        revocations: [{ id: "3".repeat(64), authorPubkey: ISSUER, awardIds: [target.id], createdAt: NOW - 10 }],
      }),
    );
    expect(people.find((entry) => entry.pubkey === USER_A)?.status).toBe("expired");
  });

  it("ignores revocations from signers who are neither issuer nor admin", () => {
    const target = award({ holderPubkey: USER_A });
    const people = projectPeople(
      baseInput({
        awards: [target],
        revocations: [{ id: "3".repeat(64), authorPubkey: USER_C, awardIds: [target.id], createdAt: NOW - 10 }],
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
  it("lists admin-authored role definitions with canonical permission order", () => {
    const shuffled: PeopleDefinitionInput = { ...roleDef, permissions: ["invites", "events"] };
    const roles = projectRoles({
      definitions: [shuffled, membershipDef],
      trust,
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

  it("drops roles from non-admin authors, including the root key", () => {
    const foreign: PeopleDefinitionInput = {
      ...roleDef,
      address: `30009:${USER_C}:role`,
      authorPubkey: USER_C,
      d: "role",
    };
    const rootAuthored: PeopleDefinitionInput = {
      ...roleDef,
      address: `30009:${ROOT}:root-role`,
      authorPubkey: ROOT,
      d: "root-role",
    };
    const roles = projectRoles({
      definitions: [roleDef, foreign, rootAuthored],
      trust,
      activePubkey: USER_A,
    });
    expect(roles).toHaveLength(1);
    expect(roles[0].editable).toBe(false);
  });
});
