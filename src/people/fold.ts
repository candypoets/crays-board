/**
 * Pure people/roles projection fold per PRD §8.7 and venue-commerce-nip §3.6/§4.
 * Everything here is synchronous and fully unit-testable; the subscription
 * coordinator in usePeople.ts only extracts plain inputs from worker events
 * and calls this.
 *
 * There is no member table: a person appears because they are a root venue
 * admin (NIP-11) or hold a role/membership award whose definition exists on
 * the venue relay. Expired and revoked awards keep the person listed with an
 * Expired status (they grant nothing, but they are the only trace that the
 * person ever had access); untrusted, malformed, and unrelated awards never
 * create a person.
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

/** PRD §8.7: Expiring soon when a relevant award ends within 30 days. */
export const EXPIRING_SOON_SECONDS = 30 * 24 * 60 * 60;

/** venue-commerce-nip §3.6: at most four configurable roles in v1. */
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
  type?: string;
  description?: string;
  permissions: Permission[];
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
  /** A trusted kind 5 references this award; it grants nothing. */
  revoked: boolean;
  /** Grants access right now: not revoked and not expired. */
  active: boolean;
};

export type Person = {
  pubkey: string;
  displayName: string;
  /** Root venue administrator (NIP-11 authority); cannot be revoked here. */
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
  /** §3.1 update rule: only the original publishing key may edit in place. */
  editable: boolean;
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Latest addressable definition per address (§3.1: created_at, ties by id). */
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
  /** NIP-11 venue authorities: the root admins (venue-commerce-nip §1). */
  authorities: ReadonlySet<string>;
  /** Venue authorities + advertised badge issuer; award/revocation trust. */
  trustedIssuers: ReadonlySet<string>;
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
  authorities,
  trustedIssuers,
  now,
}: PeopleProjectionInput): Person[] {
  const definitionByAddress = latestDefinitions(definitions);
  const profileByPubkey = latestProfiles(profiles);

  const revokedIds = new Set<string>();
  for (const revocation of revocations) {
    if (!trustedIssuers.has(revocation.authorPubkey)) continue;
    for (const awardId of revocation.awardIds) revokedIds.add(awardId);
  }

  const awardsByHolder = new Map<string, PersonAward[]>();
  for (const award of awards) {
    if (!trustedIssuers.has(award.issuerPubkey)) continue;
    const definition = definitionByAddress.get(award.definitionAddress);
    if (!definition) continue; // definition must exist on the venue relay
    if (definition.type !== "role" && definition.type !== "membership") continue;

    const revoked = revokedIds.has(award.id);
    const expired = award.expiresAt !== undefined && award.expiresAt <= now;
    const entry: PersonAward = {
      id: award.id,
      definitionAddress: award.definitionAddress,
      ...(definition.name ? { name: definition.name } : {}),
      kind: definition.type,
      permissions: definition.permissions,
      ...(award.expiresAt !== undefined ? { expiresAt: award.expiresAt } : {}),
      revoked,
      active: !revoked && !expired,
    };
    const list = awardsByHolder.get(award.holderPubkey) ?? [];
    list.push(entry);
    awardsByHolder.set(award.holderPubkey, list);
  }

  const pubkeys = new Set<string>([...authorities, ...awardsByHolder.keys()]);
  const people: Person[] = [];
  for (const pubkey of pubkeys) {
    const isRootAdmin = authorities.has(pubkey);
    const personAwards = awardsByHolder.get(pubkey) ?? [];
    const activeAwards = personAwards.filter((award) => award.active);

    // Root venue administrators are always Active (PRD §8.7, PEOPLE-05).
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
  /** Role definitions count only from trusted authorities (§3.1). */
  trustedIssuers: ReadonlySet<string>;
  /** Active staff pubkey; decides in-place editability. */
  activePubkey?: string;
};

/** Projects the Roles & access list (venue-commerce-nip §3.6, ROLE-01). */
export function projectRoles({ definitions, trustedIssuers, activePubkey }: RolesProjectionInput): RoleSummary[] {
  const definitionByAddress = latestDefinitions(definitions);
  const roles: RoleSummary[] = [];
  for (const definition of definitionByAddress.values()) {
    if (definition.type !== "role") continue;
    if (!trustedIssuers.has(definition.authorPubkey)) continue;
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
