/// <reference types="jest" />

import "../../polyfills/text-encoding";

import {
  KIND_DELETION,
  buildRevocation,
  buildRoleAssignment,
  buildRoleDefinition,
  parseExpiryInput,
  resolveAssigneePubkey,
} from "@/people/builders";

const ADMIN = "a".repeat(64);
const HOLDER = "b".repeat(64);
const AWARD_ID = "c".repeat(64);
const ROLE_ADDRESS = `30009:${ADMIN}:qa-role`;
const NOW = 1_800_000_000;

describe("buildRevocation", () => {
  it("produces the exact kind 5 reference (PEOPLE-04)", () => {
    const template = buildRevocation({ awardId: AWARD_ID });
    expect(template.kind).toBe(KIND_DELETION);
    expect(template.kind).toBe(5);
    expect(template.tags).toEqual([
      ["e", AWARD_ID],
      ["k", "8"],
    ]);
    expect(template.content).toBe("");
  });

  it("carries an optional reason in content", () => {
    const template = buildRevocation({ awardId: AWARD_ID, reason: "  Repeated no-shows  " });
    expect(template.content).toBe("Repeated no-shows");
  });

  it("rejects a malformed award id", () => {
    expect(() => buildRevocation({ awardId: "not-hex" })).toThrow();
  });
});

describe("buildRoleDefinition", () => {
  it("produces the exact §3.6 tag set with repeated permission tags", () => {
    const template = buildRoleDefinition({
      d: "qa-role",
      name: "Events host",
      description: "Welcomes guests and handles entry.",
      permissions: ["invites", "events"],
    });
    expect(template.kind).toBe(30009);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["d", "qa-role"],
      ["type", "role"],
      ["t", "role"],
      ["name", "Events host"],
      ["description", "Welcomes guests and handles entry."],
      ["permission", "events"],
      ["permission", "invites"],
    ]);
  });

  it("emits permission tags in canonical matrix order and skips blank description", () => {
    const template = buildRoleDefinition({
      d: "qa-role",
      name: "Owner",
      description: "   ",
      permissions: ["settings", "posts", "store"],
    });
    expect(template.tags).toEqual([
      ["d", "qa-role"],
      ["type", "role"],
      ["t", "role"],
      ["name", "Owner"],
      ["permission", "posts"],
      ["permission", "store"],
      ["permission", "settings"],
    ]);
  });

  it("rejects invalid input (no write on rejection)", () => {
    expect(() => buildRoleDefinition({ d: "", name: "Staff", permissions: [] })).toThrow();
    expect(() => buildRoleDefinition({ d: "x", name: " a ", permissions: [] })).toThrow();
    expect(() =>
      buildRoleDefinition({ d: "x", name: "Staff", permissions: ["billing" as never] }),
    ).toThrow();
  });
});

describe("buildRoleAssignment", () => {
  it("produces the exact §4 a/p tags for a permanent assignment", () => {
    const template = buildRoleAssignment({ roleAddress: ROLE_ADDRESS, holderPubkey: HOLDER.toUpperCase() });
    expect(template.kind).toBe(8);
    expect(template.tags).toEqual([
      ["a", ROLE_ADDRESS],
      ["p", HOLDER],
    ]);
  });

  it("adds the NIP-40 expiration tag for timed assignments", () => {
    const template = buildRoleAssignment({
      roleAddress: ROLE_ADDRESS,
      holderPubkey: HOLDER,
      expiresAt: NOW + 3600,
      now: NOW,
    });
    expect(template.tags).toContainEqual(["expiration", String(NOW + 3600)]);
  });

  it("rejects bad address, bad key, and past expiry (ROLE-03)", () => {
    expect(() => buildRoleAssignment({ roleAddress: `8:${ADMIN}:qa-role`, holderPubkey: HOLDER })).toThrow();
    expect(() => buildRoleAssignment({ roleAddress: ROLE_ADDRESS, holderPubkey: "npub1xyz" })).toThrow();
    expect(() =>
      buildRoleAssignment({ roleAddress: ROLE_ADDRESS, holderPubkey: HOLDER, expiresAt: NOW - 1, now: NOW }),
    ).toThrow();
  });
});

describe("resolveAssigneePubkey", () => {
  it("accepts hex pubkeys case-insensitively", () => {
    expect(resolveAssigneePubkey(`  ${HOLDER.toUpperCase()}  `)).toBe(HOLDER);
  });

  it("decodes npubs to the hex pubkey", () => {
    // Reference pair produced with nostr-tools nip19.npubEncode("ab".repeat(32)).
    expect(resolveAssigneePubkey("npub14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4scf6zts")).toBe(
      "ab".repeat(32),
    );
  });

  it("rejects anything else", () => {
    expect(() => resolveAssigneePubkey("")).toThrow();
    expect(() => resolveAssigneePubkey("nsec1qqqqqq")).toThrow();
    expect(() => resolveAssigneePubkey("npub1invalid")).toThrow();
    expect(() => resolveAssigneePubkey("z".repeat(64))).toThrow();
    // Corrupted checksum on an otherwise valid npub.
    expect(() =>
      resolveAssigneePubkey("npub14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4scf6ztq"),
    ).toThrow();
  });
});

describe("parseExpiryInput", () => {
  it("treats blank as permanent", () => {
    expect(parseExpiryInput("   ", NOW)).toBeUndefined();
  });

  it("parses YYYY-MM-DD as end of day UTC", () => {
    expect(parseExpiryInput("2027-01-15", NOW)).toBe(Math.floor(Date.parse("2027-01-15T23:59:59Z") / 1000));
  });

  it("rejects malformed and past dates", () => {
    expect(() => parseExpiryInput("15/01/2027", NOW)).toThrow();
    expect(() => parseExpiryInput("2020-01-01", NOW)).toThrow();
  });
});
