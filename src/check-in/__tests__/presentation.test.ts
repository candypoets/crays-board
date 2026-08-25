/// <reference types="jest" />

import type { CommunityTrust } from "@/access/trust";
import {
  REJECTION_MESSAGE,
  validatePresentation,
  type CheckInAward,
  type CheckInContext,
  type CheckInStatus,
  type SignatureVerifier,
} from "@/check-in/presentation";

/**
 * nostr-tools cannot load under jest-expo (its @noble/curves ESM chain is not
 * transformed), so signature semantics are tested with a deterministic fake:
 * the fake "signature" is a stable hash of the signed fields, and the fake
 * verifier recomputes it — tampering with any field breaks verification the
 * same way a real Schnorr check would. Real verification runs in the app via
 * nostr-tools verifyEvent (the injected default).
 */

const ROOT = "0".repeat(64);
const ADMIN = "a".repeat(64);
const ISSUER = "b".repeat(64);
const STRANGER = "f".repeat(64);
const HOLDER = "c".repeat(64);
const OTHER_HOLDER = "e".repeat(64);
const EVENT_ADDRESS = `31923:${ADMIN}:supper-club`;
const WRONG_EVENT_ADDRESS = `31923:${ADMIN}:gala-night`;
const TICKET_ADDRESS = `30402:${ADMIN}:supper-ticket`;
const AWARD_ID = "d".repeat(64);
const NOW = 1_700_000_000;
const RELAY_URL = "wss://venue.example.com";

const TRUST: CommunityTrust = { rootPubkey: ROOT, admins: new Set([ADMIN]), badgeIssuer: ISSUER };

const award: CheckInAward = {
  id: AWARD_ID,
  issuerPubkey: ISSUER,
  definitionAddress: TICKET_ADDRESS,
  holderPubkey: HOLDER,
  createdAt: NOW - 50,
  maxUses: 1,
  sellable: true,
};

type SignedFields = { pubkey: string; kind: number; created_at: number; content: string; tags: string[][] };

function fakeDigest(fields: SignedFields): string {
  const text = JSON.stringify([fields.pubkey, fields.kind, fields.created_at, fields.content, fields.tags]);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(index), 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 31) + text.charCodeAt(index)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function fakeSign(fields: SignedFields): Record<string, unknown> {
  const core = fakeDigest(fields);
  return {
    ...fields,
    id: core.repeat(4),
    sig: core.repeat(8),
  };
}

const fakeVerify: SignatureVerifier = (event) =>
  event.id === fakeDigest(event).repeat(4) && event.sig === fakeDigest(event).repeat(8);

function makeTags(overrides: { e?: string; a?: string; event?: string } = {}): string[][] {
  return [
    ["type", "nuts_entitlement_presentation"],
    ["expiration", String(NOW + 90)],
    ["nonce", "qa-nonce"],
    ["e", overrides.e ?? AWARD_ID],
    ["a", overrides.a ?? TICKET_ADDRESS],
    ["r", RELAY_URL],
    ["event", overrides.event ?? EVENT_ADDRESS],
  ];
}

function makePresentation(
  overrides: {
    tags?: string[][];
    pubkey?: string;
    kind?: number;
    createdAt?: number;
    tamper?: (event: Record<string, unknown>) => void;
  } = {},
): string {
  const fields: SignedFields = {
    pubkey: overrides.pubkey ?? HOLDER,
    kind: overrides.kind ?? 27236,
    created_at: overrides.createdAt ?? NOW,
    content: "",
    tags: overrides.tags ?? makeTags(),
  };
  const event = fakeSign(fields);
  overrides.tamper?.(event);
  return JSON.stringify(event);
}

/** The `nuts:present:<base64url(JSON)>` wire format (unpadded base64url). */
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function wrapWire(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
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
  return `nuts:present:${output.replace(/\+/g, "-").replace(/\//g, "_")}`;
}

let statusSeq = 0;
function makeStatus(overrides: Partial<CheckInStatus> = {}): CheckInStatus {
  statusSeq += 1;
  return {
    id: statusSeq.toString(16).padStart(64, "0"),
    awardId: AWARD_ID,
    definitionAddress: TICKET_ADDRESS,
    holderPubkey: HOLDER,
    signerPubkey: ADMIN,
    contextKey: `event:${EVENT_ADDRESS}`,
    status: "fulfilled",
    createdAt: NOW - 10,
    ...overrides,
  };
}

function context(overrides: Partial<CheckInContext> = {}): CheckInContext {
  return {
    eventAddress: EVENT_ADDRESS,
    venueRelayUrl: RELAY_URL,
    awards: [award],
    statuses: [],
    revocations: [],
    trust: TRUST,
    now: NOW,
    ...overrides,
  };
}

function validate(raw: string, ctx: CheckInContext = context()) {
  return validatePresentation(raw, ctx, fakeVerify);
}

describe("validatePresentation", () => {
  it("accepts a valid presentation bound to venue, event, holder, and award", () => {
    const result = validate(makePresentation());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.award.id).toBe(AWARD_ID);
      expect(result.presentation.holderPubkey).toBe(HOLDER);
      expect(result.presentation.eventAddress).toBe(EVENT_ADDRESS);
    }
  });

  it("accepts the nuts:present: base64url wire format", () => {
    const result = validate(wrapWire(makePresentation()));
    expect(result.ok).toBe(true);
  });

  it("rejects an undecodable or non-JSON wire payload as malformed", () => {
    expect(validate("nuts:present:!!!")).toEqual({ ok: false, reason: "malformed" });
    expect(validate(wrapWire("not json"))).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects unparseable input as malformed", () => {
    for (const raw of ["", "not json", "[]", "42", '{"kind":27236}']) {
      expect(validate(raw)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects a signed event of the wrong kind as malformed", () => {
    expect(validate(makePresentation({ kind: 1 }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a tampered payload as invalid signature", () => {
    const raw = makePresentation({
      tamper: (event) => {
        // Retagging after "signing" breaks the signature, like a forged pass.
        event.tags = makeTags({ event: WRONG_EVENT_ADDRESS });
      },
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("requires the entitlement presentation type tag", () => {
    const wrongType = makeTags().map((tag) => (tag[0] === "type" ? ["type", "nuts_identity_presentation"] : tag));
    expect(validate(makePresentation({ tags: wrongType }))).toEqual({ ok: false, reason: "malformed" });
    const noType = makeTags().filter((tag) => tag[0] !== "type");
    expect(validate(makePresentation({ tags: noType }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("requires a nonce", () => {
    const noNonce = makeTags().filter((tag) => tag[0] !== "nonce");
    expect(validate(makePresentation({ tags: noNonce }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("requires the award and definition references", () => {
    const noAward = makeTags().filter((tag) => tag[0] !== "e");
    expect(validate(makePresentation({ tags: noAward }))).toEqual({ ok: false, reason: "malformed" });
    const noDefinition = makeTags().filter((tag) => tag[0] !== "a");
    expect(validate(makePresentation({ tags: noDefinition }))).toEqual({ ok: false, reason: "malformed" });
    expect(validate(makePresentation({ tags: makeTags({ a: "30402:not-hex-supper-ticket" }) }))).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("requires the exact community relay pin", () => {
    expect(validate(makePresentation({ tags: makeTags().map((tag) => (tag[0] === "r" ? ["r", "wss://other.example.com"] : tag)) }))).toEqual({
      ok: false,
      reason: "malformed",
    });
    const badRelay = makeTags().map((tag) => (tag[0] === "r" ? ["r", "https://venue.example.com"] : tag));
    expect(validate(makePresentation({ tags: badRelay }))).toEqual({ ok: false, reason: "malformed" });
    const noRelay = makeTags().filter((tag) => tag[0] !== "r");
    expect(validate(makePresentation({ tags: noRelay }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("requires exactly one fulfillment context", () => {
    const both = [...makeTags(), ["order", "CR-1"]];
    expect(validate(makePresentation({ tags: both }))).toEqual({ ok: false, reason: "malformed" });
    const neither = makeTags().filter((tag) => tag[0] !== "event");
    expect(validate(makePresentation({ tags: neither }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a presentation missing its expiry window as malformed", () => {
    const noExpiration = makeTags().filter((tag) => tag[0] !== "expiration");
    expect(validate(makePresentation({ tags: noExpiration }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a presentation that is not valid yet", () => {
    expect(validate(makePresentation({ createdAt: NOW + 1000 }))).toEqual({
      ok: false,
      reason: "not_yet_valid",
    });
  });

  it("rejects an expired presentation", () => {
    const raw = makePresentation({
      createdAt: NOW - 30,
      tags: makeTags().map((tag) => (tag[0] === "expiration" ? ["expiration", String(NOW - 1)] : tag)),
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a stale presentation beyond the 90 second window as expired", () => {
    const raw = makePresentation({
      createdAt: NOW - 120,
      tags: makeTags().map((tag) => (tag[0] === "expiration" ? ["expiration", String(NOW + 3600)] : tag)),
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "expired" });
    // The window edge itself is still valid.
    const edge = makePresentation({
      createdAt: NOW - 90,
      tags: makeTags().map((tag) => (tag[0] === "expiration" ? ["expiration", String(NOW + 3600)] : tag)),
    });
    expect(validate(edge).ok).toBe(true);
  });

  it("rejects a presentation for a different event", () => {
    expect(validate(makePresentation({ tags: makeTags({ event: WRONG_EVENT_ADDRESS }) }))).toEqual({
      ok: false,
      reason: "wrong_event",
    });
  });

  it("rejects an order-context presentation at the door as wrong event", () => {
    const orderContext = [...makeTags().filter((tag) => tag[0] !== "event"), ["order", "CR-1"]];
    expect(validate(makePresentation({ tags: orderContext }))).toEqual({ ok: false, reason: "wrong_event" });
  });

  it("reports wrong event before already checked in", () => {
    const raw = makePresentation({ tags: makeTags({ event: WRONG_EVENT_ADDRESS }) });
    const result = validate(raw, context({ statuses: [makeStatus()] }));
    expect(result).toEqual({ ok: false, reason: "wrong_event" });
  });

  it("rejects a presentation referencing an unknown award", () => {
    expect(validate(makePresentation({ tags: makeTags({ e: "9".repeat(64) }) }))).toEqual({
      ok: false,
      reason: "unknown_award",
    });
  });

  it("rejects an award presented by someone other than its holder", () => {
    expect(validate(makePresentation({ pubkey: OTHER_HOLDER }))).toEqual({ ok: false, reason: "wrong_holder" });
  });

  it("rejects a payload whose definition address does not match the award", () => {
    expect(validate(makePresentation({ tags: makeTags({ a: `30402:${ADMIN}:other-ticket` }) }))).toEqual({
      ok: false,
      reason: "wrong_award",
    });
  });

  it("rejects an award from an untrusted issuer", () => {
    const forged: CheckInAward = { ...award, issuerPubkey: STRANGER };
    expect(validate(makePresentation(), context({ awards: [forged] }))).toEqual({
      ok: false,
      reason: "untrusted_issuer",
    });
  });

  it("applies NIP-97 issuance rules: the badge issuer may not award non-sellable definitions", () => {
    // Direct free-admission award: the definition is the event itself (sellable=false).
    const direct: CheckInAward = {
      ...award,
      issuerPubkey: ISSUER,
      definitionAddress: EVENT_ADDRESS,
      sellable: false,
    };
    const raw = makePresentation({ tags: makeTags({ a: EVENT_ADDRESS }) });
    expect(validate(raw, context({ awards: [direct] }))).toEqual({ ok: false, reason: "untrusted_issuer" });

    const adminGranted: CheckInAward = { ...direct, issuerPubkey: ADMIN };
    expect(validate(raw, context({ awards: [adminGranted] })).ok).toBe(true);

    // The badge issuer may award a sellable (priced) ticket definition.
    const nonSellableTicket: CheckInAward = { ...award, sellable: false };
    expect(validate(makePresentation(), context({ awards: [nonSellableTicket] }))).toEqual({
      ok: false,
      reason: "untrusted_issuer",
    });
  });

  it("rejects a revoked award, but only when the revocation signer is valid", () => {
    const byAdmin = context({ revocations: [{ authorPubkey: ADMIN, references: [AWARD_ID] }] });
    expect(validate(makePresentation(), byAdmin)).toEqual({ ok: false, reason: "revoked" });

    const byIssuer = context({ revocations: [{ authorPubkey: ISSUER, references: [AWARD_ID] }] });
    expect(validate(makePresentation(), byIssuer)).toEqual({ ok: false, reason: "revoked" });

    const byStranger = context({ revocations: [{ authorPubkey: STRANGER, references: [AWARD_ID] }] });
    expect(validate(makePresentation(), byStranger).ok).toBe(true);
  });

  it("rejects an already fulfilled award as already checked in", () => {
    const result = validate(makePresentation(), context({ statuses: [makeStatus()] }));
    expect(result).toEqual({ ok: false, reason: "already_checked_in" });
  });

  it("counts fulfilled contexts across all of the award's contexts", () => {
    // A store-order fulfillment consumes the single use just like admission.
    const orderUse = context({ statuses: [makeStatus({ contextKey: "order:CR-1" })] });
    expect(validate(makePresentation(), orderUse)).toEqual({ ok: false, reason: "already_checked_in" });
    // A fulfillment at another event also consumes the use.
    const otherEvent = context({
      statuses: [makeStatus({ contextKey: `event:${WRONG_EVENT_ADDRESS}` })],
    });
    expect(validate(makePresentation(), otherEvent)).toEqual({ ok: false, reason: "already_checked_in" });
    // Statuses from untrusted signers never consume uses.
    const untrusted = context({ statuses: [makeStatus({ signerPubkey: STRANGER })] });
    expect(validate(makePresentation(), untrusted).ok).toBe(true);
  });

  it("ignores statuses whose a/p binding is wrong or whose timestamp predates the award", () => {
    for (const malformed of [
      makeStatus({ definitionAddress: `30402:${ADMIN}:other` }),
      makeStatus({ holderPubkey: OTHER_HOLDER }),
      makeStatus({ createdAt: award.createdAt - 1 }),
    ]) {
      expect(validate(makePresentation(), context({ statuses: [malformed] })).ok).toBe(true);
    }
  });

  it("un-counts a use when the latest status of a context is cancelled", () => {
    const cancelled = context({
      statuses: [
        makeStatus({ id: "1".repeat(64), createdAt: NOW - 20, status: "fulfilled" }),
        makeStatus({ id: "2".repeat(64), createdAt: NOW - 10, status: "cancelled" }),
      ],
    });
    expect(validate(makePresentation(), cancelled).ok).toBe(true);

    const reFulfilled = context({
      statuses: [
        makeStatus({ id: "1".repeat(64), createdAt: NOW - 20, status: "cancelled" }),
        makeStatus({ id: "2".repeat(64), createdAt: NOW - 10, status: "fulfilled" }),
      ],
    });
    expect(validate(makePresentation(), reFulfilled)).toEqual({ ok: false, reason: "already_checked_in" });
  });

  it("honors remaining uses for multi-use awards", () => {
    const pass: CheckInAward = { ...award, maxUses: 2 };
    const oneUsed = context({
      awards: [pass],
      statuses: [makeStatus({ contextKey: `event:${WRONG_EVENT_ADDRESS}` })],
    });
    expect(validate(makePresentation(), oneUsed).ok).toBe(true);

    const exhausted = context({
      awards: [pass],
      statuses: [
        makeStatus({ contextKey: `event:${WRONG_EVENT_ADDRESS}` }),
        makeStatus({ contextKey: `event:${EVENT_ADDRESS}` }),
      ],
    });
    expect(validate(makePresentation(), exhausted)).toEqual({ ok: false, reason: "already_checked_in" });
  });

  it("treats a locally fulfilled award as already checked in before the relay echo", () => {
    const result = validate(makePresentation(), context({ locallyFulfilledAwardIds: new Set([AWARD_ID]) }));
    expect(result).toEqual({ ok: false, reason: "already_checked_in" });
  });

  it("does not double-count the local fulfillment once the relay echo arrives", () => {
    const pass: CheckInAward = { ...award, maxUses: 2 };
    const result = validate(
      makePresentation(),
      context({
        awards: [pass],
        statuses: [makeStatus()],
        locallyFulfilledAwardIds: new Set([AWARD_ID]),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("provides guest-safe wording for every rejection class", () => {
    expect(REJECTION_MESSAGE.already_checked_in).toBe("Already checked in");
    expect(REJECTION_MESSAGE.wrong_event).toContain("different event");
    expect(REJECTION_MESSAGE.expired).toContain("expired");
    expect(REJECTION_MESSAGE.invalid_signature).toContain("Invalid signature");
  });
});
