import {
  ROOM_MANIFEST_D_PREFIX,
  ROOM_MANIFEST_SCHEMA,
  type Availability,
  type MembershipPeriod,
} from "./protocol";

/**
 * Pure settings projections. The subscription coordinator in
 * useSettingsData.ts extracts plain inputs at the worker boundary and folds
 * them through these functions, mirroring src/orders/fold.ts.
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

/** Latest addressable venue profile at d=nuts-community-profile, or null. */
export function foldVenueProfile(inputs: VenueProfileInput[]): VenueProfile | null {
  const latest = latestByCreatedAt(inputs);
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
  period?: string;
  availability?: string;
};

/**
 * Latest membership definition per stable d, oldest plan first. Only
 * type=membership definitions reach this fold (the coordinator filters).
 */
export function foldMemberships(inputs: MembershipInput[]): MembershipPlan[] {
  const byD = new Map<string, MembershipInput>();
  for (const input of inputs) {
    const previous = byD.get(input.d);
    if (!previous || isNewer(input, previous)) byD.set(input.d, input);
  }
  return [...byD.values()]
    .map((input) => ({
      ...input,
      name: input.name ?? input.d,
      description: input.description ?? "",
      period: normalizePeriod(input.period),
      availability: normalizeAvailability(input.availability),
    }))
    .sort((a, b) => a.createdAt - b.createdAt || (a.d < b.d ? -1 : 1));
}

function normalizePeriod(value: string | undefined): MembershipPeriod {
  return value === "monthly" || value === "yearly" ? value : "one-time";
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
 * Latest valid room manifest. A manifest counts only when it follows the
 * versioned contract: d=life.crays/room/v1/<room-id>, matching schema tag,
 * operator equal to the signing pubkey, and a future expiration (crays-rn
 * protocol-contract; ROOM-01 — expired or wrong-authority manifests are never
 * shown as healthy). Relay reachability and gateway health are deliberately
 * not derived here (ROOM-02 separation).
 */
export function foldRoomManifest(inputs: RoomManifestInput[], now: number): RoomManifest | null {
  const valid = inputs.filter(
    (input) =>
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

/** §3.1 resolution: latest by created_at; ties break by higher event id. */
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
