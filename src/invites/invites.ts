import "@/polyfills/text-encoding";

import type { EventTemplate } from "nostr-tools";

/**
 * Pure invite-creation contract for PRD §8.8. Creation is a scoped HTTP side
 * effect on the selected venue's existing `/invites` service, authorized by
 * one NIP-98 kind 27235 event bound to the exact URL, method, and SHA-256
 * payload (mirrors .qa/relay-lib.mjs nip98Header and the service-side check
 * in strfry-badge-node crates/invite). The raw invite token is never
 * displayed separately or logged: the only derived value that leaves this
 * module is the log marker payload from inviteLogMarker, which carries the
 * token's unsigned claims (nonce/expiry/max) — never the signed token.
 */

export type ClaimExpiryOption = { id: string; label: string; seconds: number };
export type MembershipDurationOption = { id: string; label: string; seconds: number | null };

/** PRD §8.8 claim expiry choices: 1 hour, 1 day, 7 days, 30 days. */
export const CLAIM_EXPIRY_OPTIONS: ClaimExpiryOption[] = [
  { id: "1h", label: "1 hour", seconds: 3_600 },
  { id: "1d", label: "1 day", seconds: 86_400 },
  { id: "7d", label: "7 days", seconds: 604_800 },
  { id: "30d", label: "30 days", seconds: 2_592_000 },
];

/** PRD §8.8 membership duration choices: permanent, 30 days, 90 days, 1 year. */
export const MEMBERSHIP_DURATION_OPTIONS: MembershipDurationOption[] = [
  { id: "permanent", label: "Permanent", seconds: null },
  { id: "30d", label: "30 days", seconds: 2_592_000 },
  { id: "90d", label: "90 days", seconds: 7_776_000 },
  { id: "1y", label: "1 year", seconds: 31_536_000 },
];

/** Maximum redemptions choices; the service enforces a minimum of 1. */
export const MAX_REDEMPTION_OPTIONS: number[] = [1, 5, 10, 25, 50];

export type InviteConfig = {
  claimExpirySeconds: number;
  /** null = permanent membership (badge_expires_in_seconds is omitted). */
  membershipDurationSeconds: number | null;
  maxRedemptions: number;
};

export type InviteEndpoints = {
  /** URL the POST is sent to (reachable from this device). */
  requestUrl: string;
  /** URL the NIP-98 `u` tag binds to (the service's canonical base URL). */
  authUrl: string;
};

export type InviteServiceResponse = {
  token: string;
  expiresAt: number;
  badgeExpiresAt: number | null;
  maxRedemptions: number;
};

export type InviteClaims = {
  v: 1;
  nonce: string;
  badge: string;
  exp: number;
  badge_exp?: number;
  max: number;
};

function normalizeServiceUrl(serviceUrl: string): string {
  if (!/^https?:\/\//.test(serviceUrl)) throw new Error("The venue invite service address is invalid.");
  return serviceUrl.replace(/\/+$/, "");
}

/**
 * Resolves the invite endpoint pair for a venue service URL. The request goes
 * to the URL as given, but the NIP-98 `u` tag must match the service's
 * configured NIP98_BASE_URL exactly: in the dev coordinator's direct-ports
 * mode that is the loopback URL, while Android emulators reach the same
 * service through the 10.0.2.2 host alias. The alias is therefore mapped back
 * to loopback for the auth tag only. Production https URLs pass through
 * unchanged.
 */
export function inviteEndpoints(serviceUrl: string): InviteEndpoints {
  const base = normalizeServiceUrl(serviceUrl);
  const authBase = base.replace(/^http:\/\/10\.0\.2\.2(?=[:/])/, "http://127.0.0.1");
  return { requestUrl: `${base}/invites`, authUrl: `${authBase}/invites` };
}

/**
 * Serializes the exact request body bytes. Key order is fixed so the SHA-256
 * payload tag and the transmitted body can never drift apart; a permanent
 * membership omits badge_expires_in_seconds entirely.
 */
export function buildInviteRequestBody(config: InviteConfig): string {
  if (!Number.isSafeInteger(config.claimExpirySeconds) || config.claimExpirySeconds < 1) {
    throw new Error("Choose how long the claim link stays valid.");
  }
  if (
    config.membershipDurationSeconds !== null &&
    (!Number.isSafeInteger(config.membershipDurationSeconds) || config.membershipDurationSeconds < 1)
  ) {
    throw new Error("Choose how long the granted membership lasts.");
  }
  if (!Number.isSafeInteger(config.maxRedemptions) || config.maxRedemptions < 1) {
    throw new Error("Maximum redemptions must be at least 1.");
  }
  const body: Record<string, number> = { expires_in_seconds: config.claimExpirySeconds };
  if (config.membershipDurationSeconds !== null) {
    body.badge_expires_in_seconds = config.membershipDurationSeconds;
  }
  body.max_redemptions = config.maxRedemptions;
  return JSON.stringify(body);
}

/**
 * NIP-98 authorization event template (kind 27235) binding the exact URL,
 * POST method, and SHA-256 hex of the exact body bytes.
 */
export function buildNip98Template(authUrl: string, payloadHashHex: string): EventTemplate {
  if (!/^[0-9a-f]{64}$/.test(payloadHashHex)) throw new Error("The payload hash is not a SHA-256 hex digest.");
  return {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", authUrl],
      ["method", "POST"],
      ["payload", payloadHashHex],
    ],
    content: "",
  };
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** UTF-8 → base64url without padding (NIP-98 authorization header encoding). */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    output += BASE64_ALPHABET[a >> 2];
    output += BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)] : "";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[c & 63] : "";
  }
  return output.replace(/\+/g, "-").replace(/\//g, "_");
}

/** base64url (padding optional) → UTF-8 text. */
export function fromBase64Url(encoded: string): string {
  const clean = encoded.replace(/-/g, "+").replace(/_/g, "/");
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) throw new Error("Invalid base64url value.");
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
    const values = chunk.split("").map((char) => BASE64_ALPHABET.indexOf(char));
    const a = values[0];
    const b = values[1] ?? 0;
    const c = values[2] ?? 0;
    const d = values[3] ?? 0;
    bytes.push((a << 2) | (b >> 4));
    if (chunk.length > 2) bytes.push(((b & 15) << 4) | (c >> 2));
    if (chunk.length > 3) bytes.push(((c & 3) << 6) | d);
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** `Authorization` header value for the signed kind 27235 event. */
export function nip98AuthorizationHeader(signedEventJson: string): string {
  return `Nostr ${toBase64Url(signedEventJson)}`;
}

/**
 * The guest redeem URL: crays-rn's invite entry path (`/invite` route with
 * service/relay/token params), preserving service URL, relay URL, and token
 * through guest authentication (PRD §8.8, INVITE-05). Never a nuts-cash-only
 * /redeem link.
 */
export function buildRedeemUrl({
  serviceUrl,
  relayUrl,
  token,
}: {
  serviceUrl: string;
  relayUrl: string;
  token: string;
}): string {
  const base = normalizeServiceUrl(serviceUrl);
  if (!/^wss?:\/\//.test(relayUrl)) throw new Error("The venue relay address is invalid.");
  if (!token.includes(".")) throw new Error("The invite service returned an incomplete token.");
  return (
    `crays://invite?service=${encodeURIComponent(base)}` +
    `&relay=${encodeURIComponent(relayUrl)}&token=${encodeURIComponent(token)}`
  );
}

/** Validates the /invites service response shape before anything is shown. */
export function parseInviteResponse(data: unknown): InviteServiceResponse {
  if (!data || typeof data !== "object") throw new Error("The invite service returned an unreadable response.");
  const value = data as Record<string, unknown>;
  if (typeof value.token !== "string" || !value.token.includes(".")) {
    throw new Error("The invite service returned an incomplete token.");
  }
  if (!Number.isSafeInteger(value.expires_at) || Number(value.expires_at) < 1) {
    throw new Error("The invite service returned no claim expiry.");
  }
  if (value.badge_expires_at !== undefined && value.badge_expires_at !== null && !Number.isSafeInteger(value.badge_expires_at)) {
    throw new Error("The invite service returned an invalid membership expiry.");
  }
  if (!Number.isSafeInteger(value.max_redemptions) || Number(value.max_redemptions) < 1) {
    throw new Error("The invite service returned an invalid redemption limit.");
  }
  return {
    token: value.token,
    expiresAt: Number(value.expires_at),
    badgeExpiresAt: value.badge_expires_at == null ? null : Number(value.badge_expires_at),
    maxRedemptions: Number(value.max_redemptions),
  };
}

/**
 * Decodes the unsigned claims segment of an invite token. Used ONLY to build
 * the QA log marker; the signature segment and the full token never leave
 * the create flow.
 */
export function decodeInviteClaims(token: string): InviteClaims {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("The invite token is malformed.");
  let claims: unknown;
  try {
    claims = JSON.parse(fromBase64Url(parts[0]));
  } catch {
    throw new Error("The invite token is malformed.");
  }
  const value = claims as Partial<InviteClaims>;
  if (
    value.v !== 1 ||
    typeof value.nonce !== "string" ||
    !value.nonce ||
    typeof value.badge !== "string" ||
    !Number.isSafeInteger(value.exp) ||
    !Number.isSafeInteger(value.max)
  ) {
    throw new Error("The invite token carries unsupported claims.");
  }
  return value as InviteClaims;
}

/**
 * Logcat marker payload for `[crays-board-invite]`. Deliberately carries only
 * unsigned claims (nonce, expiries, max) and the service host — the signed
 * token is never logged.
 */
export function inviteLogMarker(response: InviteServiceResponse, serviceUrl: string): Record<string, unknown> {
  const claims = decodeInviteClaims(response.token);
  return {
    nonce: claims.nonce,
    exp: response.expiresAt,
    badge_exp: response.badgeExpiresAt,
    max: response.maxRedemptions,
    service: normalizeServiceUrl(serviceUrl).replace(/^https?:\/\//, ""),
  };
}

/** Short human labels for the result badges. */
export function expiryLabel(seconds: number): string {
  return CLAIM_EXPIRY_OPTIONS.find((option) => option.seconds === seconds)?.label ?? `${seconds}s`;
}

export function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Permanent";
  return MEMBERSHIP_DURATION_OPTIONS.find((option) => option.seconds === seconds)?.label ?? `${seconds}s`;
}
