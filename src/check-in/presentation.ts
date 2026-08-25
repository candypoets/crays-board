import type { Event } from "nostr-tools";

import { eventContextKey, isDefinitionAddress } from "@/access/nip97";
import {
  awardIssuerValid,
  revocationSignerValid,
  statusSignerValid,
  type CommunityTrust,
} from "@/access/trust";
import type { PublishedOrderStatus } from "@/nostr/protocol";

/**
 * Check-in presentation validation (NIP-97, spec of record ~/nips/97.md).
 *
 * A guest presents a short-lived kind 27236 credential, signed by the holder
 * key, either as the full signed event JSON (manual entry) or prefixed and
 * base64url-encoded: `nuts:present:<base64url(JSON)>` (no padding — strip the
 * prefix and decode). Grammar (mirrors crays-rn src/access/presentation.ts):
 *
 * ```
 * kind: 27236
 * pubkey: <holder pubkey>            // the presenting guest signs
 * tags:
 *   ["type", "nuts_entitlement_presentation"]
 *   ["expiration", "<unix>"]         // short-lived expiry (required)
 *   ["nonce", "<random>"]            // replay guard (required)
 *   ["e", "<award event id>"]        // the referenced kind 8 award
 *   ["a", "<definition address>"]    // 30402 ticket def or the event itself
 *   ["r", "<community relay URL>"]   // required venue relay pinning
 *   ["event", "31923:<author>:<d>"]  // admission context, xor `order`
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

export const PRESENTATION_PREFIX = "nuts:present:";
export const ENTITLEMENT_PRESENTATION_TYPE = "nuts_entitlement_presentation";

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
/** Tolerance for holder/device clock skew on the not-yet-valid window. */
const CLOCK_SKEW_SECONDS = 300;
/** Staleness window: a presentation older than this is expired (nuts-cash rule). */
const STALE_AFTER_SECONDS = 90;

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
  /** Calendar event coordinate from the `event` context tag. */
  eventAddress: string;
  createdAt: number;
  expiresAt: number;
};

/**
 * Award facts needed for binding, issuance, and remaining-use checks: the
 * expected attendees for the active event, resolved by fold.ts.
 */
export type CheckInAward = {
  id: string;
  issuerPubkey: string;
  definitionAddress: string;
  holderPubkey: string;
  createdAt: number;
  /** From the referenced definition; 30402 tickets default to 1. */
  maxUses: number;
  /** From the referenced definition; direct free-admission awards are not sellable. */
  sellable: boolean;
};

/**
 * Status facts needed for remaining-use checks. Only statuses with a valid
 * NIP-97 context (parseStatusContext at the worker boundary) reach here.
 */
export type CheckInStatus = {
  id: string;
  awardId: string;
  definitionAddress: string;
  holderPubkey: string;
  signerPubkey: string;
  /** Fulfillment context key: `order:<ref>` or `event:<coordinate>`. */
  contextKey: string;
  status: PublishedOrderStatus;
  createdAt: number;
};

/** Kind 5 revocation facts. */
export type CheckInRevocation = {
  authorPubkey: string;
  /** Award event ids referenced by `e` tags. */
  references: string[];
};

export type CheckInContext = {
  /** The active calendar event coordinate (31923:<author>:<d>). */
  eventAddress: string;
  /** The venue relay URL presentations are pinned to via their `r` tag. */
  venueRelayUrl: string;
  awards: CheckInAward[];
  statuses: CheckInStatus[];
  revocations: CheckInRevocation[];
  trust: CommunityTrust;
  now: number;
  /**
   * Awards this device just fulfilled whose relay echo has not arrived yet:
   * rescans resolve to exactly one fulfillment, even before the subscription
   * catches up.
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

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64url (padding optional) → UTF-8 text; undefined on any invalid input. */
function decodeBase64Url(encoded: string): string | undefined {
  const clean = encoded.replace(/-/g, "+").replace(/_/g, "/");
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) return undefined;
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
  try {
    return new TextDecoder().decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}

/** Strips the optional `nuts:present:` wire prefix and returns the JSON text. */
function unwrapPresentation(raw: string): string | undefined {
  const text = raw.trim();
  if (!text.startsWith(PRESENTATION_PREFIX)) return text;
  return decodeBase64Url(text.slice(PRESENTATION_PREFIX.length));
}

/** NIP-97: the presented `a` tag may reference any definition family. */
function isValidDefinitionAddress(value: string): boolean {
  const [, author, ...d] = value.split(":");
  return isDefinitionAddress(value) && HEX_64.test((author ?? "").toLowerCase()) && d.join(":").length > 0;
}

function isValidEventCoordinate(value: string): boolean {
  const [kind, author, ...d] = value.split(":");
  return (
    (kind === "31922" || kind === "31923") &&
    HEX_64.test((author ?? "").toLowerCase()) &&
    d.join(":").length > 0
  );
}

function isValidRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:") && Boolean(url.host);
  } catch {
    return false;
  }
}

/**
 * Latest status per fulfillment context of one award, restricted to trusted
 * signers (statusSignerValid). Resolution per NIP-97: latest created_at,
 * lowest event id breaks ties.
 */
function latestPerContext(
  award: CheckInAward,
  statuses: CheckInStatus[],
  trust: CommunityTrust,
): Map<string, CheckInStatus> {
  const latest = new Map<string, CheckInStatus>();
  for (const status of statuses) {
    if (
      status.awardId !== award.id ||
      status.definitionAddress !== award.definitionAddress ||
      status.holderPubkey !== award.holderPubkey ||
      status.createdAt < award.createdAt ||
      !status.contextKey
    ) {
      continue;
    }
    if (!statusSignerValid(status.signerPubkey, trust)) continue;
    const current = latest.get(status.contextKey);
    if (
      !current ||
      status.createdAt > current.createdAt ||
      (status.createdAt === current.createdAt && status.id < current.id)
    ) {
      latest.set(status.contextKey, status);
    }
  }
  return latest;
}

/** NIP-97 derived state: one context whose latest status is fulfilled = one use. */
export function fulfilledContextCount(
  award: CheckInAward,
  statuses: CheckInStatus[],
  trust: CommunityTrust,
): number {
  let count = 0;
  for (const status of latestPerContext(award, statuses, trust).values()) {
    if (status.status === "fulfilled") count += 1;
  }
  return count;
}

/** The current status of one (award, context) pair, trusted signers only. */
export function latestStatusAtContext(
  award: CheckInAward,
  contextKey: string,
  statuses: CheckInStatus[],
  trust: CommunityTrust,
): CheckInStatus | undefined {
  return latestPerContext(award, statuses, trust).get(contextKey);
}

/**
 * Parses and cryptographically validates the presentation payload, then
 * checks every binding against relay truth in a deterministic order so each
 * rejection class gets its specific reason:
 * shape → signature → grammar (type/nonce/e/a/r/context/expiration) →
 * time window → event → award → holder → trust → revocation → remaining uses.
 */
export function validatePresentation(
  raw: string,
  context: CheckInContext,
  verify: SignatureVerifier = defaultVerifier(),
): ValidationResult {
  const json = unwrapPresentation(raw);
  if (json === undefined) return reject("malformed");

  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
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

  const type = tagValue(event.tags, "type");
  const nonce = tagValue(event.tags, "nonce");
  const awardId = tagValue(event.tags, "e")?.toLowerCase();
  const definitionAddress = tagValue(event.tags, "a") ?? "";
  const relay = tagValue(event.tags, "r");
  const orderContext = tagValue(event.tags, "order");
  const eventContext = tagValue(event.tags, "event");
  const expiration = Number(tagValue(event.tags, "expiration"));
  if (type !== ENTITLEMENT_PRESENTATION_TYPE || !nonce) return reject("malformed");
  if (!awardId || !HEX_64.test(awardId) || !isValidDefinitionAddress(definitionAddress)) {
    return reject("malformed");
  }
  // The presentation is meaningful only in its pinned NIP-97 community.
  if (!relay || !isValidRelayUrl(relay) || relay !== context.venueRelayUrl) {
    return reject("malformed");
  }
  // Exactly one fulfillment context: `order` xor `event` (NIP-97 grammar).
  if (Boolean(orderContext) === Boolean(eventContext)) return reject("malformed");
  if (eventContext !== undefined && !isValidEventCoordinate(eventContext)) return reject("malformed");
  if (!Number.isSafeInteger(expiration) || expiration <= 0) return reject("malformed");

  const createdAt = event.created_at;
  if (createdAt > context.now + CLOCK_SKEW_SECONDS) return reject("not_yet_valid");
  if (expiration < context.now) return reject("expired");
  if (createdAt < context.now - STALE_AFTER_SECONDS) return reject("expired");

  // Event binding comes before award/uses checks so a wrong-event pass for an
  // already-fulfilled award still reports "different event" (specific reason).
  // An order-context presentation at the door is for a store, not this event.
  if (!eventContext || eventContext !== context.eventAddress) return reject("wrong_event");

  const award = context.awards.find((candidate) => candidate.id === awardId);
  if (!award) return reject("unknown_award");
  if (award.holderPubkey !== pubkey) return reject("wrong_holder");
  if (definitionAddress !== award.definitionAddress) return reject("wrong_award");

  // NIP-97 issuance rule: anchor admins may award anything; the delegated
  // badge issuer only sellable (priced) definitions.
  if (!awardIssuerValid({ issuer: award.issuerPubkey, sellable: award.sellable, trust: context.trust })) {
    return reject("untrusted_issuer");
  }

  const revoked = context.revocations.some(
    (revocation) =>
      revocationSignerValid(revocation.authorPubkey, award.issuerPubkey, context.trust) &&
      revocation.references.includes(award.id),
  );
  if (revoked) return reject("revoked");

  // Remaining uses: fulfilled contexts across ALL of the award's contexts
  // count, clamped at zero; a locally fulfilled award whose relay echo has
  // not arrived yet consumes its use immediately.
  const fulfilled = fulfilledContextCount(award, context.statuses, context.trust);
  const echoed =
    latestStatusAtContext(award, eventContextKey(context.eventAddress), context.statuses, context.trust)
      ?.status === "fulfilled";
  const localPending = Boolean(context.locallyFulfilledAwardIds?.has(award.id)) && !echoed;
  if (fulfilled + (localPending ? 1 : 0) >= award.maxUses) return reject("already_checked_in");

  return {
    ok: true,
    presentation: {
      id,
      holderPubkey: pubkey,
      awardId,
      definitionAddress,
      eventAddress: eventContext,
      createdAt,
      expiresAt: expiration,
    },
    award,
  };
}
