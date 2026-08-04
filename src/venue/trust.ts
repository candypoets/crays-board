/**
 * Issuer-trust discovery for the order slice (venue-commerce-nip §1, §4, §9).
 *
 * An award or status counts only when its author is:
 *  1. a venue root authority from the relay's NIP-11 document (`pubkey`,
 *     `admin_pubkeys`, `admins`, or `admin_pubkey`), or
 *  2. the badge issuer advertised by the venue's `/community/info` service.
 *
 * Staff-role awards (§9.3) are intentionally out of scope for this slice; the
 * trust set below is the explicit, complete rule for now.
 */
export type VenueTrust = {
  /** Union of NIP-11 venue authorities and the advertised badge issuer. */
  trustedIssuers: ReadonlySet<string>;
  /** Venue root authorities from NIP-11 (may be empty if the relay hid them). */
  authorities: string[];
  /** Badge issuer advertised by `/community/info`, when reachable. */
  badgeIssuer?: string;
};

const HEX_64 = /^[0-9a-f]{64}$/i;
const FETCH_TIMEOUT_MS = 8_000;

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function collectPubkeys(value: unknown, into: Set<string>): void {
  if (typeof value === "string" && HEX_64.test(value)) into.add(value.toLowerCase());
  else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && HEX_64.test(entry)) into.add(entry.toLowerCase());
    }
  }
}

async function fetchNip11Authorities(relayUrl: string): Promise<Set<string>> {
  const httpUrl = relayUrl.replace(/^ws/, "http");
  const document = (await fetchJson(httpUrl, { accept: "application/nostr+json" })) as Record<string, unknown>;
  const authorities = new Set<string>();
  collectPubkeys(document.pubkey, authorities);
  collectPubkeys(document.admin_pubkey, authorities);
  collectPubkeys(document.admin_pubkeys, authorities);
  collectPubkeys(document.admins, authorities);
  return authorities;
}

async function fetchBadgeIssuer(serviceUrl: string): Promise<string | undefined> {
  const info = (await fetchJson(`${serviceUrl.replace(/\/+$/, "")}/community/info`, {
    accept: "application/json",
  })) as Record<string, unknown>;
  const issuer = info.badge_issuer;
  return typeof issuer === "string" && HEX_64.test(issuer) ? issuer.toLowerCase() : undefined;
}

/**
 * Resolves the venue trust set from both public sources. Each source may fail
 * independently; if neither yields anything the promise rejects so callers
 * can show an honest error instead of silently trusting nobody.
 */
export async function fetchVenueTrust(relayUrl: string, serviceUrl: string): Promise<VenueTrust> {
  const [nip11, community] = await Promise.allSettled([
    fetchNip11Authorities(relayUrl),
    fetchBadgeIssuer(serviceUrl),
  ]);

  const authorities = nip11.status === "fulfilled" ? [...nip11.value] : [];
  const badgeIssuer = community.status === "fulfilled" ? community.value : undefined;

  const trustedIssuers = new Set<string>(authorities);
  if (badgeIssuer) trustedIssuers.add(badgeIssuer);

  if (trustedIssuers.size === 0) {
    throw new Error("Could not verify this venue's trusted issuers. Check the relay and service connection.");
  }
  return { trustedIssuers, authorities, badgeIssuer };
}
