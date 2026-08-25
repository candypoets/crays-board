/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";

import {
  foldMemberships,
  foldRoomManifest,
  foldVenueProfile,
  type MembershipInput,
  type RoomManifestInput,
  type VenueProfileInput,
} from "../fold";

const NOW = 1_800_000_000;
const ROOT = "f".repeat(64);
const ADMIN = "a".repeat(64);
const STRANGER = "9".repeat(64);

/** Anchor-derived trust: one admin; the root key is deliberately not an admin. */
const TRUST: CommunityTrust = { rootPubkey: ROOT, admins: new Set([ADMIN]) };

function profileInput(overrides: Partial<VenueProfileInput>): VenueProfileInput {
  return {
    id: "1".repeat(64),
    authorPubkey: ADMIN,
    createdAt: NOW - 100,
    ...overrides,
  };
}

function membershipInput(overrides: Partial<MembershipInput>): MembershipInput {
  return {
    address: `30009:${ADMIN}:plan-1`,
    id: "b".repeat(64),
    authorPubkey: ADMIN,
    d: "plan-1",
    name: "Community member",
    price: "12.00",
    currency: "EUR",
    createdAt: NOW - 100,
    ...overrides,
  };
}

function manifestInput(overrides: Partial<RoomManifestInput>): RoomManifestInput {
  return {
    id: "c".repeat(64),
    authorPubkey: ADMIN,
    d: "life.crays/room/v1/main",
    schema: "life.crays/room/v1",
    name: "Main room",
    operator: ADMIN,
    open: "open",
    capabilities: ["menu", "events"],
    createdAt: NOW - 100,
    expiresAt: NOW + 86_400,
    ...overrides,
  };
}

describe("foldVenueProfile", () => {
  it("returns null with no profile", () => {
    expect(foldVenueProfile([], TRUST)).toBeNull();
  });

  it("resolves the latest addressable profile by created_at, then id", () => {
    const older = profileInput({ id: "1".repeat(64), createdAt: NOW - 200, description: "old" });
    const newer = profileInput({ id: "2".repeat(64), createdAt: NOW - 50, description: "new" });
    expect(foldVenueProfile([older, newer], TRUST)?.description).toBe("new");
    const tieLower = profileInput({ id: "1".repeat(64), createdAt: NOW, description: "lower id" });
    const tieHigher = profileInput({ id: "3".repeat(64), createdAt: NOW, description: "higher id" });
    expect(foldVenueProfile([tieLower, tieHigher], TRUST)?.description).toBe("higher id");
  });

  it("defaults missing description and type to empty strings", () => {
    const folded = foldVenueProfile([profileInput({})], TRUST);
    expect(folded?.description).toBe("");
    expect(folded?.hospitalityType).toBe("");
  });

  it("accepts root- and admin-authored profiles, ignores untrusted authors", () => {
    expect(foldVenueProfile([profileInput({ authorPubkey: ROOT, description: "root" })], TRUST)?.description).toBe(
      "root",
    );
    expect(foldVenueProfile([profileInput({ authorPubkey: STRANGER })], TRUST)).toBeNull();
    const trusted = profileInput({ id: "1".repeat(64), createdAt: NOW - 200, description: "trusted" });
    const hostile = profileInput({ id: "2".repeat(64), authorPubkey: STRANGER, createdAt: NOW - 50, description: "hostile" });
    expect(foldVenueProfile([trusted, hostile], TRUST)?.description).toBe("trusted");
  });
});

describe("foldMemberships", () => {
  it("keeps the latest definition per stable d", () => {
    const available = membershipInput({ id: "1".repeat(64), createdAt: NOW - 200, availability: "available" });
    const flipped = membershipInput({ id: "2".repeat(64), createdAt: NOW - 50, availability: "unavailable" });
    const plans = foldMemberships([available, flipped], TRUST);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.availability).toBe("unavailable");
  });

  it("maps NIP-99 recurrence to one-time/monthly/yearly and sorts oldest first", () => {
    const monthly = membershipInput({ d: "m", address: "30009:a:m", createdAt: NOW - 10, recurrence: "month" });
    const yearly = membershipInput({ d: "y", address: "30009:a:y", createdAt: NOW - 20, recurrence: "year" });
    const oneTime = membershipInput({ d: "o", address: "30009:a:o", createdAt: NOW - 30 });
    const plans = foldMemberships([monthly, yearly, oneTime], TRUST);
    expect(plans.map((plan) => plan.period)).toEqual(["one-time", "yearly", "monthly"]);
  });

  it("normalizes unknown recurrence and availability values honestly", () => {
    const plan = foldMemberships([membershipInput({ recurrence: "week", availability: "paused" })], TRUST)[0];
    expect(plan?.period).toBe("one-time");
    expect(plan?.availability).toBe("available");
  });

  it("keeps anchor-admin authors only: the root-authored members invite badge stays out", () => {
    const membersBadge = membershipInput({
      address: `30009:${ROOT}:members`,
      authorPubkey: ROOT,
      d: "members",
      name: "Venue member",
    });
    const strangerPlan = membershipInput({
      address: `30009:${STRANGER}:plan-2`,
      authorPubkey: STRANGER,
      d: "plan-2",
    });
    expect(foldMemberships([membersBadge, strangerPlan], TRUST)).toEqual([]);
    // An untrusted rewrite must not displace the admin's older definition.
    const adminPlan = membershipInput({ id: "1".repeat(64), createdAt: NOW - 200 });
    const hostileRewrite = membershipInput({ id: "2".repeat(64), authorPubkey: STRANGER, createdAt: NOW - 50 });
    const plans = foldMemberships([adminPlan, hostileRewrite], TRUST);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.id).toBe("1".repeat(64));
  });

  it("requires a name and projects description/price/currency as published", () => {
    expect(foldMemberships([membershipInput({ name: undefined })], TRUST)).toEqual([]);
    const plan = foldMemberships([membershipInput({ description: "Support the venue." })], TRUST)[0];
    expect(plan?.name).toBe("Community member");
    expect(plan?.description).toBe("Support the venue.");
    expect(plan?.price).toBe("12.00");
    expect(plan?.currency).toBe("EUR");
  });
});

describe("foldRoomManifest", () => {
  it("projects a valid signed manifest with open state, capabilities, and issuer", () => {
    const manifest = foldRoomManifest([manifestInput({ advertisedIssuer: "d".repeat(64) })], NOW, TRUST);
    expect(manifest?.roomId).toBe("main");
    expect(manifest?.open).toBe(true);
    expect(manifest?.capabilities).toEqual(["menu", "events"]);
    expect(manifest?.advertisedIssuer).toBe("d".repeat(64));
  });

  it("projects closed state", () => {
    expect(foldRoomManifest([manifestInput({ open: "closed" })], NOW, TRUST)?.open).toBe(false);
  });

  it("rejects wrong schema, wrong d prefix, operator mismatch, and expiry (ROOM-01)", () => {
    expect(foldRoomManifest([manifestInput({ schema: "life.crays/room/v2" })], NOW, TRUST)).toBeNull();
    expect(foldRoomManifest([manifestInput({ d: "life.crays/room/v0/main" })], NOW, TRUST)).toBeNull();
    expect(foldRoomManifest([manifestInput({ operator: "e".repeat(64) })], NOW, TRUST)).toBeNull();
    expect(foldRoomManifest([manifestInput({ expiresAt: NOW - 1 })], NOW, TRUST)).toBeNull();
    expect(foldRoomManifest([manifestInput({ expiresAt: undefined })], NOW, TRUST)).toBeNull();
  });

  it("rejects manifests signed by untrusted authors, even when self-consistent", () => {
    expect(foldRoomManifest([manifestInput({ authorPubkey: STRANGER, operator: STRANGER })], NOW, TRUST)).toBeNull();
    expect(
      foldRoomManifest([manifestInput({ authorPubkey: ROOT, operator: ROOT })], NOW, TRUST)?.operatorPubkey,
    ).toBe(ROOT);
  });

  it("picks the latest valid manifest per room", () => {
    const older = manifestInput({ id: "1".repeat(64), createdAt: NOW - 300, open: "closed" });
    const newer = manifestInput({ id: "2".repeat(64), createdAt: NOW - 10, open: "open" });
    expect(foldRoomManifest([older, newer], NOW, TRUST)?.open).toBe(true);
  });
});
