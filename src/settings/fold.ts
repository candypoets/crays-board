import { definitionAuthorTrusted, type CommunityTrust } from "@/access/trust";

import {
  ROOM_MANIFEST_D_PREFIX,
  ROOM_MANIFEST_SCHEMA,
  type Availability,
  type MembershipPeriod,
} from "./protocol";

/**
 * Pure settings projections. The subscription coordinator in
 * useSettingsData.ts extracts plain inputs at the worker boundary and folds
 * them through these functions, mirroring src/orders/fold.ts. Trust comes
 * from the venue relay's NIP-97 anchor (see src/access/trust.ts).
 */

export type VenueProfile = {
  id: string;
  authorPubkey: string;
  venueName?: string;
  hospitalityType: string;
  description: string;
  menuUrl?: string;
  bookingUrl?: string;
  createdAt: number;
};

export type VenueProfileInput = Omit<VenueProfile, "hospitalityType" | "description"> & {
  hospitalityType?: string;
  description?: string;
};

/** Latest addressable venue profile at d=nuts-community-profile by a trusted author, or null. */
export function foldVenueProfile(inputs: VenueProfileInput[], trust: CommunityTrust): VenueProfile | null {
  const latest = latestByCreatedAt(inputs.filter((input) => definitionAuthorTrusted(input.authorPubkey, trust)));
  if (!latest) return null;
  return {
    ...latest,
    ...(latest.venueName ? { venueName: latest.venueName } : {}),
    hospitalityType: latest.hospitalityType ?? "",
    description: latest.description ?? "",
  };
}

export type MembershipPlan = {
  /** `30009:<author>:<d>` address. */
  address: string;
  id: string;
  authorPubkey: string;
  d: string;
  name: string;
  description: string;
  period: MembershipPeriod;
  price: string;
  currency: string;
  availability: Availability;
  createdAt: number;
};

export type MembershipInput = Omit<MembershipPlan, "name" | "description" | "period" | "availability"> & {
  name?: string;
  description?: string;
  /** Raw NIP-99 price-tag recurrence ("month"/"year"); absent for one-time plans. */
  recurrence?: string;
  availability?: string;
};

/**
 * Latest membership plan per stable d, oldest plan first. NIP-97 projection
 * rules: only anchor admins author editable plans (deliberately not the root
 * key — the relay node's root-authored `30009:<root>:members` invite-badge
 * definition stays out, same as the old type=badge exclusion), and a plan
 * requires a name. The coordinator already filtered the membership `t` topic
 * and the well-formed price tag at the worker boundary.
 */
export function foldMemberships(inputs: MembershipInput[], trust: CommunityTrust): MembershipPlan[] {
  const byD = new Map<string, MembershipInput>();
  for (const input of inputs) {
    if (!trust.admins.has(input.authorPubkey) || !input.name) continue;
    const previous = byD.get(input.d);
    if (!previous || isNewer(input, previous)) byD.set(input.d, input);
  }
  return [...byD.values()]
    .map((input) => {
      const { recurrence, ...rest } = input;
      return {
        ...rest,
        name: input.name ?? "",
        description: input.description ?? "",
        period: normalizePeriod(recurrence),
        availability: normalizeAvailability(input.availability),
      };
    })
    .sort((a, b) => a.createdAt - b.createdAt || (a.d < b.d ? -1 : 1));
}

/** NIP-99 recurrence → staff billing period: month/year map, anything else is one-time. */
function normalizePeriod(recurrence: string | undefined): MembershipPeriod {
  return recurrence === "month" ? "monthly" : recurrence === "year" ? "yearly" : "one-time";
}

function normalizeAvailability(value: string | undefined): Availability {
  return value === "unavailable" || value === "archived" ? value : "available";
}

export type RoomManifest = {
  id: string;
  /** Room id = d without the life.crays/room/v1/ prefix. */
  roomId: string;
  name: string;
  open: boolean;
  capabilities: string[];
  /** Advertised badge issuer (award_issuer tag), when present. */
  advertisedIssuer?: string;
  operatorPubkey: string;
  createdAt: number;
  expiresAt: number;
};

export type RoomManifestInput = {
  id: string;
  authorPubkey: string;
  d: string;
  schema?: string;
  name?: string;
  operator?: string;
  open?: string;
  capabilities: string[];
  advertisedIssuer?: string;
  createdAt: number;
  expiresAt?: number;
};

/**
 * Latest valid room manifest by a trusted author (anchor admin or root). A
 * manifest counts only when it follows the versioned contract:
 * d=life.crays/room/v1/<room-id>, matching schema tag, operator equal to the
 * signing pubkey, and a future expiration (crays-rn protocol-contract;
 * ROOM-01 — expired or wrong-authority manifests are never shown as
 * healthy). Relay reachability and gateway health are deliberately not
 * derived here (ROOM-02 separation).
 */
export function foldRoomManifest(inputs: RoomManifestInput[], now: number, trust: CommunityTrust): RoomManifest | null {
  const valid = inputs.filter(
    (input) =>
      definitionAuthorTrusted(input.authorPubkey, trust) &&
      input.d.startsWith(ROOM_MANIFEST_D_PREFIX) &&
      input.schema === ROOM_MANIFEST_SCHEMA &&
      !!input.operator &&
      input.operator === input.authorPubkey &&
      input.expiresAt !== undefined &&
      input.expiresAt > now,
  );
  const latest = latestByCreatedAt(valid);
  if (!latest || !latest.operator || latest.expiresAt === undefined) return null;
  return {
    id: latest.id,
    roomId: latest.d.slice(ROOM_MANIFEST_D_PREFIX.length),
    name: latest.name ?? latest.d.slice(ROOM_MANIFEST_D_PREFIX.length),
    open: latest.open !== "closed",
    capabilities: latest.capabilities,
    ...(latest.advertisedIssuer ? { advertisedIssuer: latest.advertisedIssuer } : {}),
    operatorPubkey: latest.operator,
    createdAt: latest.createdAt,
    expiresAt: latest.expiresAt,
  };
}

type Created = { id: string; createdAt: number };

/** Addressable resolution: latest by created_at; ties break by higher event id. */
function isNewer<T extends Created>(candidate: T, current: T): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt && candidate.id > current.id)
  );
}

function latestByCreatedAt<T extends Created>(inputs: T[]): T | null {
  let latest: T | null = null;
  for (const input of inputs) {
    if (!latest || isNewer(input, latest)) latest = input;
  }
  return latest;
}
