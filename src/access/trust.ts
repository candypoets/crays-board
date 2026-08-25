import {
  FULFILLMENT_KIND,
  permissionGrants,
  type CommunityAnchor,
  type Permission,
} from "@/access/nip97";

/**
 * NIP-97 trust resolution for one venue relay. The only out-of-band fact is
 * the relay's NIP-11 `pubkey` (the community root key); the root-signed
 * anchor event declares admins and the delegated badge issuer. Everything
 * entitlement-related is verified against this set, pinned to the venue
 * relay. Mirrors crays-rn src/rooms/trust.ts.
 */
export type CommunityTrust = {
  rootPubkey: string;
  admins: ReadonlySet<string>;
  badgeIssuer?: string;
  /** Live role holders whose definitions grant kind 37237 write access. */
  fulfillmentRoleHolders?: ReadonlySet<string>;
};

export function trustFromAnchor(anchor: CommunityAnchor): CommunityTrust {
  return {
    rootPubkey: anchor.pubkey,
    admins: new Set(anchor.admins),
    ...(anchor.badgeIssuer ? { badgeIssuer: anchor.badgeIssuer } : {}),
  };
}

/**
 * Trusted definition authors: anchor admins plus the root key itself. The
 * relay node authors its invite-membership definition (`30009:<root>:members`)
 * with the root key, and it must resolve whether or not the anchor lists the
 * root among its admins.
 */
export function definitionAuthorTrusted(author: string, trust: CommunityTrust): boolean {
  return trust.admins.has(author) || author === trust.rootPubkey;
}

export function nip11UrlForRelay(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  else throw new Error("The venue relay address is invalid.");
  return url.toString();
}

export function parseNip11RootPubkey(document: unknown): string | undefined {
  const pubkey = (document as { pubkey?: unknown })?.pubkey;
  return typeof pubkey === "string" && /^[0-9a-f]{64}$/i.test(pubkey) ? pubkey : undefined;
}

export async function fetchRelayRootPubkey(
  relayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(nip11UrlForRelay(relayUrl), {
    headers: { accept: "application/nostr+json" },
  });
  if (!response.ok) throw new Error("The venue relay did not identify itself.");
  const pubkey = parseNip11RootPubkey(await response.json().catch(() => ({})));
  if (!pubkey) throw new Error("The venue relay did not publish its community key.");
  return pubkey;
}

/**
 * Award issuance rule: an anchor admin may award any definition; the
 * delegated badge issuer may award sellable (priced) definitions only.
 */
export function awardIssuerValid({
  issuer,
  sellable,
  trust,
}: {
  issuer: string;
  sellable: boolean;
  trust: CommunityTrust;
}): boolean {
  if (trust.admins.has(issuer)) return true;
  return sellable && trust.badgeIssuer === issuer;
}

export type FulfillmentRoleDefinition = {
  address: string;
  id: string;
  authorPubkey: string;
  permissions: readonly Permission[];
  sellable: boolean;
  createdAt: number;
};

export type CapabilityAward = {
  id: string;
  issuerPubkey: string;
  definitionAddress: string;
  holderPubkey: string;
  expiresAt?: number;
};

export type CapabilityRevocation = {
  authorPubkey: string;
  references: readonly string[];
};

/**
 * Resolve NIP-97 delegated fulfillment staff from relay-pinned role truth.
 * Board roles are non-sellable, admin-authored definitions; their awards must
 * therefore also be admin-issued. Expired or validly revoked awards grant
 * nothing. Addressable role definitions use the normal latest-event rule.
 */
export function resolveFulfillmentRoleHolders({
  definitions,
  awards,
  revocations,
  trust,
  now,
}: {
  definitions: readonly FulfillmentRoleDefinition[];
  awards: readonly CapabilityAward[];
  revocations: readonly CapabilityRevocation[];
  trust: CommunityTrust;
  now: number;
}): ReadonlySet<string> {
  const latestDefinitions = new Map<string, FulfillmentRoleDefinition>();
  for (const definition of definitions) {
    if (!trust.admins.has(definition.authorPubkey) || definition.sellable) continue;
    const previous = latestDefinitions.get(definition.address);
    if (
      !previous ||
      definition.createdAt > previous.createdAt ||
      (definition.createdAt === previous.createdAt && definition.id > previous.id)
    ) {
      latestDefinitions.set(definition.address, definition);
    }
  }

  const eligibleDefinitions = new Set(
    [...latestDefinitions.values()]
      .filter((definition) =>
        definition.permissions.some((permission) =>
          permissionGrants(permission, FULFILLMENT_KIND, "write"),
        ),
      )
      .map((definition) => definition.address),
  );

  const holders = new Set<string>();
  for (const award of awards) {
    if (!eligibleDefinitions.has(award.definitionAddress)) continue;
    if (!awardIssuerValid({ issuer: award.issuerPubkey, sellable: false, trust })) continue;
    if (award.expiresAt !== undefined && award.expiresAt <= now) continue;
    const revoked = revocations.some(
      (revocation) =>
        revocation.references.includes(award.id) &&
        revocationSignerValid(revocation.authorPubkey, award.issuerPubkey, trust),
    );
    if (!revoked) holders.add(award.holderPubkey);
  }
  return holders;
}

/** Attach relay-resolved 37237/write role holders to the base anchor trust. */
export function trustWithFulfillmentRoles(
  trust: CommunityTrust,
  inputs: Omit<Parameters<typeof resolveFulfillmentRoleHolders>[0], "trust">,
): CommunityTrust {
  return {
    ...trust,
    fulfillmentRoleHolders: resolveFulfillmentRoleHolders({ ...inputs, trust }),
  };
}

/**
 * Fulfillment-status signers: anchor admins, the badge issuer, or a holder of
 * a live role award whose definition grants kind 37237 write access.
 */
export function statusSignerValid(signer: string, trust: CommunityTrust): boolean {
  return (
    trust.admins.has(signer) ||
    trust.badgeIssuer === signer ||
    Boolean(trust.fulfillmentRoleHolders?.has(signer))
  );
}

/** Award revocation: the award's own issuer or an anchor admin. */
export function revocationSignerValid(deleter: string, awardIssuer: string, trust: CommunityTrust): boolean {
  return deleter === awardIssuer || trust.admins.has(deleter);
}
