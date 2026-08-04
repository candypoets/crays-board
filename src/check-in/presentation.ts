import type { Event } from "nostr-tools";

import type { OrderContext, PublishedOrderStatus } from "@/nostr/protocol";

/**
 * Check-in presentation validation (venue-commerce-nip §8, EVENT-10/11/12).
 *
 * A guest presents a short-lived kind 27236 credential, signed by the holder
 * key, pasted or typed into manual entry as the full signed event JSON:
 *
 * ```
 * kind: 27236
 * pubkey: <holder pubkey>            // the presenting guest signs
 * tags:
 *   ["p", "<holder pubkey>"]         // holder binding (must equal pubkey)
 *   ["e", "<award event id>"]        // the referenced kind 8 award
 *   ["a", "30009:<author>:<d>"]      // the award's event-access definition
 *   ["event", "<31923 event id>"]    // the calendar event this entry is for
 *   ["expiration", "<unix>"]         // NIP-40 short-lived expiry (required)
 * ```
 *
 * Everything here is synchronous and pure so the whole rejection matrix is
 * unit-testable; the screen and hook only assemble the CheckInContext from
 * relay truth. Every rejection class produces a specific reason and the
 * caller writes nothing.
 */

export const KIND_PRESENTATION = 27236;
export const KIND_CALENDAR_EVENT = 31923;
export const KIND_DELETION = 5;

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
/** Tolerance for holder/device clock skew on the not-yet-valid window. */
const CLOCK_SKEW_SECONDS = 300;

export type RejectionReason =
  | "malformed"
  | "invalid_signature"
  | "wrong_holder"
  | "not_yet_valid"
  | "expired"
  | "wrong_event"
  | "wrong_award"
  | "unknown_award"
  | "untrusted_issuer"
  | "revoked"
  | "already_checked_in";

/** Guest-safe wording per rejection class; never leaks payload internals. */
export const REJECTION_MESSAGE: Record<RejectionReason, string> = {
  malformed: "This code is not a valid presentation.",
  invalid_signature: "Invalid signature — this presentation cannot be verified.",
  wrong_holder: "This presentation does not match its holder.",
  not_yet_valid: "This presentation is not valid yet.",
  expired: "This presentation has expired.",
  wrong_event: "This pass is for a different event.",
  wrong_award: "This pass does not match this event's ticket.",
  unknown_award: "This pass references an unknown award.",
  untrusted_issuer: "The award issuer is not trusted by this venue.",
  revoked: "This award has been revoked.",
  already_checked_in: "Already checked in",
};

export type ParsedPresentation = {
  id: string;
  holderPubkey: string;
  awardId: string;
  definitionAddress: string;
  eventId: string;
  createdAt: number;
  expiresAt: number;
};

/** Award facts needed for binding and remaining-use checks. */
export type CheckInAward = {
  id: string;
  issuerPubkey: string;
  definitionAddress: string;
  holderPubkey: string;
  /** From the referenced definition; event-access is single-use (default 1). */
  maxUses: number;
};

/** Status facts needed for remaining-use checks. */
export type CheckInStatus = {
  authorPubkey: string;
  contextKey: string;
  status: PublishedOrderStatus;
  context: OrderContext;
};

/** Kind 5 revocation facts. */
export type CheckInRevocation = {
  authorPubkey: string;
  /** Award event ids referenced by `e` tags. */
  references: string[];
};

export type CheckInContext = {
  /** The active calendar event id (31923) being checked in for. */
  eventId: string;
  /** The event's entrance-badge definition address. */
  accessAddress: string;
  awards: CheckInAward[];
  statuses: CheckInStatus[];
  revocations: CheckInRevocation[];
  trustedIssuers: ReadonlySet<string>;
  now: number;
  /**
   * Awards this device just fulfilled whose relay echo has not arrived yet
   * (§8.4: rescans resolve to exactly one fulfillment, even before the
   * subscription catches up).
   */
  locallyFulfilledAwardIds?: ReadonlySet<string>;
};

export type ValidationResult =
  | { ok: true; presentation: ParsedPresentation; award: CheckInAward }
  | { ok: false; reason: RejectionReason };

/** Nostr event signature check, injectable for tests. */
export type SignatureVerifier = (event: Event) => boolean;

/**
 * Resolved lazily so the pure module loads in Jest without pulling the
 * nostr-tools/@noble ESM chain (Metro bundles it statically in the app).
 */
function defaultVerifier(): SignatureVerifier {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { verifyEvent } = require("nostr-tools") as typeof import("nostr-tools");
  return verifyEvent;
}

function tagValue(tags: unknown, name: string): string | undefined {
  if (!Array.isArray(tags)) return undefined;
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") return tag[1];
  }
  return undefined;
}

function reject(reason: RejectionReason): ValidationResult {
  return { ok: false, reason };
}

/**
 * Parses and cryptographically validates the presentation payload, then
 * checks every binding against relay truth in a deterministic order so each
 * rejection class gets its specific reason:
 * shape → signature → holder → time window → event → award → trust →
 * revocation → remaining uses.
 */
export function validatePresentation(
  raw: string,
  context: CheckInContext,
  verify: SignatureVerifier = defaultVerifier(),
): ValidationResult {
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject("malformed");
    event = parsed as Record<string, unknown>;
  } catch {
    return reject("malformed");
  }

  const id = typeof event.id === "string" ? event.id.toLowerCase() : "";
  const pubkey = typeof event.pubkey === "string" ? event.pubkey.toLowerCase() : "";
  const sig = typeof event.sig === "string" ? event.sig.toLowerCase() : "";
  if (
    event.kind !== KIND_PRESENTATION ||
    !HEX_64.test(id) ||
    !HEX_64.test(pubkey) ||
    !HEX_128.test(sig) ||
    typeof event.created_at !== "number" ||
    !Array.isArray(event.tags)
  ) {
    return reject("malformed");
  }

  if (
    !verify({
      id,
      pubkey,
      sig,
      kind: KIND_PRESENTATION,
      created_at: event.created_at,
      content: typeof event.content === "string" ? event.content : "",
      tags: event.tags as string[][],
    })
  ) {
    return reject("invalid_signature");
  }

  const holder = tagValue(event.tags, "p")?.toLowerCase();
  const awardId = tagValue(event.tags, "e")?.toLowerCase();
  const definitionAddress = tagValue(event.tags, "a") ?? "";
  const eventId = tagValue(event.tags, "event")?.toLowerCase();
  const expiration = Number(tagValue(event.tags, "expiration"));
  if (!holder || !HEX_64.test(holder) || !awardId || !HEX_64.test(awardId) || !eventId || !HEX_64.test(eventId)) {
    return reject("malformed");
  }
  if (holder !== pubkey) return reject("wrong_holder");
  if (!Number.isSafeInteger(expiration) || expiration <= 0) return reject("malformed");

  const createdAt = event.created_at;
  if (createdAt > context.now + CLOCK_SKEW_SECONDS) return reject("not_yet_valid");
  if (expiration <= context.now) return reject("expired");

  // Event binding comes before award/uses checks so a wrong-event pass for an
  // already-fulfilled award still reports "different event" (specific reason).
  if (eventId !== context.eventId) return reject("wrong_event");

  const award = context.awards.find((candidate) => candidate.id === awardId);
  if (!award) return reject("unknown_award");
  if (award.holderPubkey !== holder) return reject("wrong_holder");
  if (award.definitionAddress !== context.accessAddress) return reject("wrong_event");
  if (definitionAddress !== award.definitionAddress) return reject("wrong_award");

  if (!context.trustedIssuers.has(award.issuerPubkey)) return reject("untrusted_issuer");

  const revoked = context.revocations.some(
    (revocation) =>
      context.trustedIssuers.has(revocation.authorPubkey) && revocation.references.includes(award.id),
  );
  if (revoked) return reject("revoked");

  const fulfilled = context.statuses.filter(
    (status) =>
      status.contextKey === award.id &&
      status.status === "fulfilled" &&
      status.context === "event" &&
      context.trustedIssuers.has(status.authorPubkey),
  ).length;
  const consumed = fulfilled + (context.locallyFulfilledAwardIds?.has(award.id) ? 1 : 0);
  if (consumed >= award.maxUses) return reject("already_checked_in");

  return {
    ok: true,
    presentation: { id, holderPubkey: holder, awardId, definitionAddress, eventId, createdAt, expiresAt: expiration },
    award,
  };
}
