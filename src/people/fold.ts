import {
  isNamedCapability,
  permissionGrants,
  permissionKind,
  type Permission as Nip97Permission,
} from "@/access/nip97";
import {
  awardIssuerValid,
  definitionAuthorTrusted,
  revocationSignerValid,
  type CommunityTrust,
} from "@/access/trust";

/**
 * Pure people/roles projection fold per PRD §8.7 and NIP-97 (spec of record
 * ~/nips/97.md). Everything here is synchronous and fully unit-testable; the
 * subscription coordinator in usePeople.ts only extracts plain inputs from
 * worker events and calls this.
 *
 * There is no member table: a person appears because they are the community
 * root key or an anchor admin, or hold a role/membership award whose
 * definition exists on the venue relay and whose issuer satisfies the NIP-97
 * issuance rules against the current anchor. Expired and revoked awards keep
 * the person listed with an Expired status (they grant nothing, but they are
 * the only trace that the person ever had access); untrusted, malformed, and
 * unrelated awards never create a person.
 */

export const PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** PRD §8.7 permission matrix wording. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  posts: "Posts",
  media: "Media",
  events: "Events",
  store: "Store",
  invites: "Invites",
  moderation: "Moderation",
  settings: "Settings",
};

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  posts: "Publish venue updates.",
  media: "Publish photos and media.",
  events: "Create events and manage event entry.",
  store: "Manage products, passes, paid memberships, and product orders.",
  invites: "Create join invites.",
  moderation: "Manage member behavior and revocation.",
  settings: "Change roles, permissions, venue, and payment settings.",
};

/**
 * The NIP-97 wire capability behind each matrix key (the nuts-cash
 * PermissionKey ⇄ permission-tag mapping): kind-scoped write grants for
 * on-relay features, named capabilities for off-relay ones.
 */
export const PERMISSION_CAPABILITIES: Record<Permission, Nip97Permission> = {
  posts: { capability: "1", access: "write" },
  media: { capability: "1063", access: "write" },
  events: { capability: "31923", access: "write" },
  store: { capability: "30402", access: "write" },
  invites: { capability: "invites" },
  moderation: { capability: "moderation" },
  settings: { capability: "settings" },
};

/** Does a parsed NIP-97 permission grant matrix key `key`? */
export function permissionMatchesKey(grant: Nip97Permission, key: Permission): boolean {
  const kind = permissionKind(PERMISSION_CAPABILITIES[key]);
  if (kind !== undefined) return permissionGrants(grant, kind, "write");
  return isNamedCapability(grant) && grant.capability === key;
}

/** Maps parsed NIP-97 permission tags back to the matrix keys, canonical order. */
export function permissionsFromNip97(permissions: Nip97Permission[]): Permission[] {
  return PERMISSIONS.filter((key) => permissions.some((grant) => permissionMatchesKey(grant, key)));
}

/** PRD §8.7: Expiring soon when a relevant award ends within 30 days. */
export const EXPIRING_SOON_SECONDS = 30 * 24 * 60 * 60;

/** PRD §8.7: at most four configurable roles in v1. */
export const ROLE_LIMIT = 4;

export type PersonStatus = "active" | "expiring" | "expired";

export type ProfileInput = {
  pubkey: string;
  name?: string;
  createdAt: number;
};

export type PeopleAwardInput = {
  /** Award event id; revocation targets this id. */
  id: string;
  issuerPubkey: string;
  /** `a` tag: `30009:<definition-author>:<d>`. */
  definitionAddress: string;
  /** `p` tag: the holder the award was granted to. */
  holderPubkey: string;
  createdAt: number;
  /** NIP-40 expiration, when present. */
  expiresAt?: number;
};

export type PeopleDefinitionInput = {
  /** `30009:<author>:<d>` address. */
  address: string;
  authorPubkey: string;
  /** The `d` tag, stable across edits. */
  d: string;
  id: string;
  createdAt: number;
  name?: string;
  /** `t` topic classification; anything else never reaches the projections. */
  type?: "role" | "membership";
  description?: string;
  /** Matrix keys mapped back from the definition's NIP-97 permission tags. */
  permissions: Permission[];
  /** Well-formed NIP-99 price tag present (drives the issuance rules). */
  sellable: boolean;
};

export type RevocationInput = {
  /** Kind 5 event id. */
  id: string;
  authorPubkey: string;
  /** Award ids referenced by the deletion event's `e` tags. */
  awardIds: string[];
  createdAt: number;
};

export type PersonAward = {
  id: string;
  definitionAddress: string;
  name?: string;
  kind: "role" | "membership";
  permissions: Permission[];
  expiresAt?: number;
  /** A valid kind 5 references this award; it grants nothing. */
  revoked: boolean;
  /** Grants access right now: not revoked and not expired. */
  active: boolean;
};

export type Person = {
  pubkey: string;
  displayName: string;
  /** Community root key or anchor admin; cannot be revoked here. */
  isRootAdmin: boolean;
  status: PersonStatus;
  /** Nearest expiry among active awards, when any has an expiration. */
  nearestExpiry?: number;
  awards: PersonAward[];
  /** Union of permissions granted by active role awards, canonical order. */
  permissions: Permission[];
};

export type RoleSummary = {
  address: string;
  d: string;
  authorPubkey: string;
  name: string;
  description: string;
  permissions: Permission[];
  /** NIP-97 update rule: only the original publishing key may edit in place. */
  editable: boolean;
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Definition trust gate (NIP-97): role authoring is reserved to anchor admins
 * (the privilege-escalation boundary); membership definitions additionally
 * trust the root key, which authors the node's `members` invite definition.
 */
export function definitionTrusted(definition: PeopleDefinitionInput, trust: CommunityTrust): boolean {
  if (definition.type === "role") return trust.admins.has(definition.authorPubkey);
  if (definition.type === "membership") return definitionAuthorTrusted(definition.authorPubkey, trust);
  return false;
}

/** Latest addressable definition per address (created_at, ties by id). */
export function latestDefinitions(definitions: PeopleDefinitionInput[]): Map<string, PeopleDefinitionInput> {
  const latest = new Map<string, PeopleDefinitionInput>();
  for (const definition of definitions) {
    const previous = latest.get(definition.address);
    if (
      !previous ||
      definition.createdAt > previous.createdAt ||
      (definition.createdAt === previous.createdAt && definition.id > previous.id)
    ) {
      latest.set(definition.address, definition);
    }
  }
  return latest;
}

function latestProfiles(profiles: ProfileInput[]): Map<string, ProfileInput> {
  const latest = new Map<string, ProfileInput>();
  for (const profile of profiles) {
    const previous = latest.get(profile.pubkey);
    if (!previous || profile.createdAt >= previous.createdAt) latest.set(profile.pubkey, profile);
  }
  return latest;
}

export type PeopleProjectionInput = {
  awards: PeopleAwardInput[];
  definitions: PeopleDefinitionInput[];
  revocations: RevocationInput[];
  profiles: ProfileInput[];
  /** NIP-97 trust resolved from the root-signed community anchor. */
  trust: CommunityTrust;
  now: number;
};

/**
 * Projects the People list (PRD §8.7, PEOPLE-01/02/05). Venue binding is
 * owned by the caller: only events learned from the active venue relay reach
 * this fold.
 */
export function projectPeople({
  awards,
  definitions,
  revocations,
  profiles,
  trust,
  now,
}: PeopleProjectionInput): Person[] {
  const definitionByAddress = latestDefinitions(
    definitions.filter((definition) => definitionTrusted(definition, trust)),
  );
  const profileByPubkey = latestProfiles(profiles);
  const awardById = new Map(awards.map((award) => [award.id, award]));

  // A revocation counts only from the award's own issuer or an anchor admin.
  const revokedIds = new Set<string>();
  for (const revocation of revocations) {
    for (const awardId of revocation.awardIds) {
      const target = awardById.get(awardId);
      if (target && revocationSignerValid(revocation.authorPubkey, target.issuerPubkey, trust)) {
        revokedIds.add(awardId);
      }
    }
  }

  const awardsByHolder = new Map<string, PersonAward[]>();
  for (const award of awards) {
    const definition = definitionByAddress.get(award.definitionAddress);
    if (!definition) continue; // definition must exist on the venue relay
    if (!awardIssuerValid({ issuer: award.issuerPubkey, sellable: definition.sellable, trust })) continue;

    const revoked = revokedIds.has(award.id);
    const expired = award.expiresAt !== undefined && award.expiresAt <= now;
    const entry: PersonAward = {
      id: award.id,
      definitionAddress: award.definitionAddress,
      ...(definition.name ? { name: definition.name } : {}),
      kind: definition.type as "role" | "membership",
      permissions: definition.permissions,
      ...(award.expiresAt !== undefined ? { expiresAt: award.expiresAt } : {}),
      revoked,
      active: !revoked && !expired,
    };
    const list = awardsByHolder.get(award.holderPubkey) ?? [];
    list.push(entry);
    awardsByHolder.set(award.holderPubkey, list);
  }

  // The community root key and every anchor admin are always listed Active.
  const authorities = new Set<string>([trust.rootPubkey, ...trust.admins]);
  const pubkeys = new Set<string>([...authorities, ...awardsByHolder.keys()]);
  const people: Person[] = [];
  for (const pubkey of pubkeys) {
    const isRootAdmin = authorities.has(pubkey);
    const personAwards = awardsByHolder.get(pubkey) ?? [];
    const activeAwards = personAwards.filter((award) => award.active);

    // Root key and anchor admins are always Active (PRD §8.7, PEOPLE-05).
    let status: PersonStatus;
    let nearestExpiry: number | undefined;
    if (isRootAdmin || activeAwards.length > 0) {
      for (const award of activeAwards) {
        if (award.expiresAt === undefined) continue;
        if (nearestExpiry === undefined || award.expiresAt < nearestExpiry) nearestExpiry = award.expiresAt;
      }
      status =
        !isRootAdmin && nearestExpiry !== undefined && nearestExpiry - now <= EXPIRING_SOON_SECONDS
          ? "expiring"
          : "active";
    } else {
      status = "expired";
    }

    const permissionSet = new Set<Permission>();
    for (const award of activeAwards) {
      if (award.kind !== "role") continue;
      for (const permission of award.permissions) permissionSet.add(permission);
    }

    const profile = profileByPubkey.get(pubkey);
    people.push({
      pubkey,
      displayName: profile?.name?.trim() ? profile.name.trim() : `${pubkey.slice(0, 12)}…`,
      isRootAdmin,
      status,
      ...(nearestExpiry !== undefined ? { nearestExpiry } : {}),
      awards: personAwards,
      permissions: PERMISSIONS.filter((permission) => permissionSet.has(permission)),
    });
  }

  const statusRank: Record<PersonStatus, number> = { active: 0, expiring: 1, expired: 2 };
  return people.sort((a, b) => {
    if (a.isRootAdmin !== b.isRootAdmin) return a.isRootAdmin ? -1 : 1;
    if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status];
    return a.displayName.localeCompare(b.displayName);
  });
}

export type RolesProjectionInput = {
  definitions: PeopleDefinitionInput[];
  /** NIP-97 trust; role definitions count only from anchor admins. */
  trust: CommunityTrust;
  /** Active staff pubkey; decides in-place editability. */
  activePubkey?: string;
};

/** Projects the Roles & access list (PRD §8.7, ROLE-01). */
export function projectRoles({ definitions, trust, activePubkey }: RolesProjectionInput): RoleSummary[] {
  const definitionByAddress = latestDefinitions(
    definitions.filter((definition) => definitionTrusted(definition, trust)),
  );
  const roles: RoleSummary[] = [];
  for (const definition of definitionByAddress.values()) {
    if (definition.type !== "role") continue;
    roles.push({
      address: definition.address,
      d: definition.d,
      authorPubkey: definition.authorPubkey,
      name: definition.name?.trim() ? definition.name.trim() : definition.d,
      description: definition.description ?? "",
      permissions: PERMISSIONS.filter((permission) => definition.permissions.includes(permission)),
      editable: activePubkey !== undefined && definition.authorPubkey === activePubkey.toLowerCase(),
    });
  }
  return roles.sort((a, b) => a.name.localeCompare(b.name));
}
