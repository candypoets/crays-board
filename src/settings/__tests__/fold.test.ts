/// <reference types="jest" />

import {
  foldMemberships,
  foldRoomManifest,
  foldVenueProfile,
  type MembershipInput,
  type RoomManifestInput,
  type VenueProfileInput,
} from "../fold";

const NOW = 1_800_000_000;

function profileInput(overrides: Partial<VenueProfileInput>): VenueProfileInput {
  return {
    id: "a".repeat(64),
    authorPubkey: "f".repeat(64),
    createdAt: NOW - 100,
    ...overrides,
  };
}

function membershipInput(overrides: Partial<MembershipInput>): MembershipInput {
  return {
    address: `30009:${"f".repeat(64)}:plan-1`,
    id: "b".repeat(64),
    authorPubkey: "f".repeat(64),
    d: "plan-1",
    price: "12.00",
    currency: "EUR",
    createdAt: NOW - 100,
    ...overrides,
  };
}

function manifestInput(overrides: Partial<RoomManifestInput>): RoomManifestInput {
  const operator = "e".repeat(64);
  return {
    id: "c".repeat(64),
    authorPubkey: operator,
    d: "life.crays/room/v1/main",
    schema: "life.crays/room/v1",
    name: "Main room",
    operator,
    open: "open",
    capabilities: ["menu", "events"],
    createdAt: NOW - 100,
    expiresAt: NOW + 86_400,
    ...overrides,
  };
}

describe("foldVenueProfile", () => {
  it("returns null with no profile", () => {
    expect(foldVenueProfile([])).toBeNull();
  });

  it("resolves the latest addressable profile by created_at, then id", () => {
    const older = profileInput({ id: "1".repeat(64), createdAt: NOW - 200, description: "old" });
    const newer = profileInput({ id: "2".repeat(64), createdAt: NOW - 50, description: "new" });
    expect(foldVenueProfile([older, newer])?.description).toBe("new");
    const tieLower = profileInput({ id: "1".repeat(64), createdAt: NOW, description: "lower id" });
    const tieHigher = profileInput({ id: "3".repeat(64), createdAt: NOW, description: "higher id" });
    expect(foldVenueProfile([tieLower, tieHigher])?.description).toBe("higher id");
  });

  it("defaults missing description and type to empty strings", () => {
    const folded = foldVenueProfile([profileInput({})]);
    expect(folded?.description).toBe("");
    expect(folded?.hospitalityType).toBe("");
  });
});

describe("foldMemberships", () => {
  it("keeps the latest definition per stable d", () => {
    const available = membershipInput({ id: "1".repeat(64), createdAt: NOW - 200, availability: "available" });
    const flipped = membershipInput({ id: "2".repeat(64), createdAt: NOW - 50, availability: "unavailable" });
    const plans = foldMemberships([available, flipped]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.availability).toBe("unavailable");
  });

  it("projects one-time/monthly/yearly periods and sorts oldest first", () => {
    const monthly = membershipInput({ d: "m", address: "30009:f:m", createdAt: NOW - 10, period: "monthly" });
    const yearly = membershipInput({ d: "y", address: "30009:f:y", createdAt: NOW - 20, period: "yearly" });
    const oneTime = membershipInput({ d: "o", address: "30009:f:o", createdAt: NOW - 30, period: "one-time" });
    const plans = foldMemberships([monthly, yearly, oneTime]);
    expect(plans.map((plan) => plan.period)).toEqual(["one-time", "yearly", "monthly"]);
  });

  it("normalizes unknown period and availability values honestly", () => {
    const plan = foldMemberships([membershipInput({ period: "weekly", availability: "paused" })])[0];
    expect(plan?.period).toBe("one-time");
    expect(plan?.availability).toBe("available");
  });
});

describe("foldRoomManifest", () => {
  it("projects a valid signed manifest with open state, capabilities, and issuer", () => {
    const manifest = foldRoomManifest([manifestInput({ advertisedIssuer: "d".repeat(64) })], NOW);
    expect(manifest?.roomId).toBe("main");
    expect(manifest?.open).toBe(true);
    expect(manifest?.capabilities).toEqual(["menu", "events"]);
    expect(manifest?.advertisedIssuer).toBe("d".repeat(64));
  });

  it("projects closed state", () => {
    expect(foldRoomManifest([manifestInput({ open: "closed" })], NOW)?.open).toBe(false);
  });

  it("rejects wrong schema, wrong d prefix, operator mismatch, and expiry (ROOM-01)", () => {
    expect(foldRoomManifest([manifestInput({ schema: "life.crays/room/v2" })], NOW)).toBeNull();
    expect(foldRoomManifest([manifestInput({ d: "life.crays/room/v0/main" })], NOW)).toBeNull();
    expect(foldRoomManifest([manifestInput({ operator: "9".repeat(64) })], NOW)).toBeNull();
    expect(foldRoomManifest([manifestInput({ expiresAt: NOW - 1 })], NOW)).toBeNull();
    expect(foldRoomManifest([manifestInput({ expiresAt: undefined })], NOW)).toBeNull();
  });

  it("picks the latest valid manifest per room", () => {
    const older = manifestInput({ id: "1".repeat(64), createdAt: NOW - 300, open: "closed" });
    const newer = manifestInput({ id: "2".repeat(64), createdAt: NOW - 10, open: "open" });
    expect(foldRoomManifest([older, newer], NOW)?.open).toBe(true);
  });
});
