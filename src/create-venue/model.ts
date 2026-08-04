import type { EventTemplate } from "nostr-tools";

/**
 * Pure create-venue logic (PRD §8.2): draft shape, per-step validation, slug
 * derivation, the coordinator relay request, and the venue profile template.
 * Everything here is synchronous and fully unit-testable; side effects live
 * in coordinator.ts / attempts.ts / provision.ts.
 */

export const VENUE_PROFILE_D = "nuts-community-profile";
export const VENUE_PROFILE_KIND = 30078;
export const VENUE_TYPE = "hospitality";
/** Established membership badge identifier carried by every venue relay. */
export const BADGE_D = "members";

export const NAME_MIN = 2;
export const NAME_MAX = 50;
export const DESCRIPTION_MAX = 200;
export const SLUG_MAX = 63;

export type SetupIntentions = {
  menu: boolean;
  payments: boolean;
  invites: boolean;
  room: boolean;
};

export type VenueDraft = {
  name: string;
  description: string;
  timezone: string;
  address: string;
  /** Optional simple opening window, 24h "HH:MM"; both empty or both valid. */
  opensAt: string;
  closesAt: string;
  ownerName: string;
  recoveryAcknowledged: boolean;
  intentions: SetupIntentions;
};

export const emptyDraft = (): VenueDraft => ({
  name: "",
  description: "",
  timezone: suggestTimezone(),
  address: "",
  opensAt: "",
  closesAt: "",
  ownerName: "",
  recoveryAcknowledged: false,
  intentions: { menu: true, payments: false, invites: true, room: false },
});

/** Device timezone suggestion; Place step lets the user confirm or change it. */
export function suggestTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.length > 0) return zone;
  } catch {
    // Hermes without full ICU still validates below.
  }
  return "UTC";
}

/**
 * Derived relay slug (PRD §8.2): lowercase ASCII letters/numbers/hyphens,
 * trimmed, at most 63 characters, safe fallback when the name cannot produce
 * one. The user's venue name is never mutated to make the slug.
 */
export function deriveSlug(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return normalized.length > 0 ? normalized : "venue";
}

export function validateVenueName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give the venue a name.";
  if (trimmed.length < NAME_MIN) return `The name needs at least ${NAME_MIN} characters.`;
  if (trimmed.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  return null;
}

export function validateDescription(description: string): string | null {
  if (description.length > DESCRIPTION_MAX) {
    return `Keep the introduction under ${DESCRIPTION_MAX} characters.`;
  }
  return null;
}

const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+/-]{1,63}$/;
const HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateTimezone(timezone: string): string | null {
  const trimmed = timezone.trim();
  if (trimmed.length === 0) return "Confirm the venue timezone.";
  if (!TIMEZONE_PATTERN.test(trimmed)) return "Use an IANA timezone such as Europe/Luxembourg.";
  return null;
}

/** Both hours empty is valid (optional); otherwise both must be valid HH:MM with end after start. */
export function validateHours(opensAt: string, closesAt: string): string | null {
  const open = opensAt.trim();
  const close = closesAt.trim();
  if (!open && !close) return null;
  if (!HOUR_PATTERN.test(open) || !HOUR_PATTERN.test(close)) {
    return "Opening hours use 24-hour HH:MM, such as 18:00.";
  }
  if (close <= open) return "Closing time must be after opening time.";
  return null;
}

/** Gate for the step's Continue action. Steps: 0 identity, 1 place, 2 service, 3 review. */
export function stepError(draft: VenueDraft, step: number, hasSigner: boolean): string | null {
  if (step === 0) {
    return validateVenueName(draft.name) ?? validateDescription(draft.description);
  }
  if (step === 1) {
    return validateTimezone(draft.timezone) ?? validateHours(draft.opensAt, draft.closesAt);
  }
  if (step === 2) {
    if (!hasSigner) return "Create or import the owner staff account first.";
    if (!draft.recoveryAcknowledged) return "Acknowledge how this account can be recovered.";
    return null;
  }
  return null;
}

/** Coordinator relay creation payload (POST /relays, NIP-98 authorized). */
export type RelayRequest = {
  name: string;
  description: string;
  domain_label: string;
  admin_pubkeys: string[];
  badge_d: string;
};

export function buildRelayRequest(draft: VenueDraft, domainLabel: string, ownerPubkey: string): RelayRequest {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    domain_label: domainLabel,
    admin_pubkeys: [ownerPubkey.toLowerCase()],
    badge_d: BADGE_D,
  };
}

/** Unique per venue-creation attempt; the attempt id is persisted before the POST. */
export function makeAttemptId(now = Date.now()): string {
  return `cv-${now.toString(36)}-${randomSuffix(4)}`;
}

export function makeDomainLabel(slug: string): string {
  return `craysboard-venue-${slug}-${randomSuffix(5)}`;
}

function randomSuffix(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Venue profile published to the NEW relay after readiness (venue-commerce-nip; PRD §8.2 step 12). */
export function buildVenueProfileTemplate(draft: VenueDraft): EventTemplate {
  const tags: string[][] = [
    ["d", VENUE_PROFILE_D],
    ["type", VENUE_TYPE],
    ["t", VENUE_TYPE],
    ["name", draft.name.trim()],
  ];
  const about = draft.description.trim();
  if (about) tags.push(["about", about]);
  // Address and opening hours stay in resumable creation state until the
  // venue-profile contract for them is finalized (PRD §8.2) — they are never
  // fabricated into relay truth.
  return { kind: VENUE_PROFILE_KIND, tags, content: "", created_at: Math.floor(Date.now() / 1000) };
}

/** base64url without Buffer (Hermes); used for the NIP-98 authorization header. */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | (b >> 4)];
    output += index + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=";
    output += index + 2 < bytes.length ? alphabet[c & 63] : "=";
  }
  return output.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
