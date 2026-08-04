/// <reference types="jest" />

import {
  REJECTION_MESSAGE,
  validatePresentation,
  type CheckInAward,
  type CheckInContext,
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

const ADMIN = "a".repeat(64);
const ISSUER = "b".repeat(64);
const STRANGER = "f".repeat(64);
const HOLDER = "c".repeat(64);
const OTHER_HOLDER = "e".repeat(64);
const ACCESS_ADDRESS = `30009:${ADMIN}:qa-event-access`;
const EVENT_ID = "1".repeat(64);
const WRONG_EVENT_ID = "2".repeat(64);
const AWARD_ID = "d".repeat(64);
const NOW = 1_700_000_000;

const TRUSTED = new Set([ADMIN, ISSUER]);

const award: CheckInAward = {
  id: AWARD_ID,
  issuerPubkey: ISSUER,
  definitionAddress: ACCESS_ADDRESS,
  holderPubkey: HOLDER,
  maxUses: 1,
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
    tags: overrides.tags ?? [
      ["p", HOLDER],
      ["e", AWARD_ID],
      ["a", ACCESS_ADDRESS],
      ["event", EVENT_ID],
      ["expiration", String(NOW + 3600)],
    ],
  };
  const event = fakeSign(fields);
  overrides.tamper?.(event);
  return JSON.stringify(event);
}

function context(overrides: Partial<CheckInContext> = {}): CheckInContext {
  return {
    eventId: EVENT_ID,
    accessAddress: ACCESS_ADDRESS,
    awards: [award],
    statuses: [],
    revocations: [],
    trustedIssuers: TRUSTED,
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
      expect(result.presentation.eventId).toBe(EVENT_ID);
    }
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
        event.tags = [
          ["p", HOLDER],
          ["e", AWARD_ID],
          ["a", ACCESS_ADDRESS],
          ["event", WRONG_EVENT_ID],
          ["expiration", String(NOW + 3600)],
        ];
      },
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a presentation whose holder tag does not match the signer", () => {
    const raw = makePresentation({
      tags: [
        ["p", OTHER_HOLDER],
        ["e", AWARD_ID],
        ["a", ACCESS_ADDRESS],
        ["event", EVENT_ID],
        ["expiration", String(NOW + 3600)],
      ],
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "wrong_holder" });
  });

  it("rejects an award presented by someone other than its holder", () => {
    const raw = makePresentation({
      pubkey: OTHER_HOLDER,
      tags: [
        ["p", OTHER_HOLDER],
        ["e", AWARD_ID],
        ["a", ACCESS_ADDRESS],
        ["event", EVENT_ID],
        ["expiration", String(NOW + 3600)],
      ],
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "wrong_holder" });
  });

  it("rejects a presentation that is not valid yet", () => {
    expect(validate(makePresentation({ createdAt: NOW + 1000 }))).toEqual({
      ok: false,
      reason: "not_yet_valid",
    });
  });

  it("rejects an expired presentation", () => {
    const raw = makePresentation({
      createdAt: NOW - 7200,
      tags: [
        ["p", HOLDER],
        ["e", AWARD_ID],
        ["a", ACCESS_ADDRESS],
        ["event", EVENT_ID],
        ["expiration", String(NOW - 60)],
      ],
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a presentation missing its expiry window as malformed", () => {
    const raw = makePresentation({
      tags: [
        ["p", HOLDER],
        ["e", AWARD_ID],
        ["a", ACCESS_ADDRESS],
        ["event", EVENT_ID],
      ],
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a presentation for a different event", () => {
    const raw = makePresentation({
      tags: [
        ["p", HOLDER],
        ["e", AWARD_ID],
        ["a", ACCESS_ADDRESS],
        ["event", WRONG_EVENT_ID],
        ["expiration", String(NOW + 3600)],
      ],
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "wrong_event" });
  });

  it("reports wrong event before already checked in", () => {
    const raw = makePresentation({
      tags: [
        ["p", HOLDER],
        ["e", AWARD_ID],
        ["a", ACCESS_ADDRESS],
        ["event", WRONG_EVENT_ID],
        ["expiration", String(NOW + 3600)],
      ],
    });
    const result = validate(
      raw,
      context({
        statuses: [{ authorPubkey: ADMIN, contextKey: AWARD_ID, status: "fulfilled", context: "event" }],
      }),
    );
    expect(result).toEqual({ ok: false, reason: "wrong_event" });
  });

  it("rejects a presentation referencing an unknown award", () => {
    const raw = makePresentation({
      tags: [
        ["p", HOLDER],
        ["e", "9".repeat(64)],
        ["a", ACCESS_ADDRESS],
        ["event", EVENT_ID],
        ["expiration", String(NOW + 3600)],
      ],
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "unknown_award" });
  });

  it("rejects an award for a different event-access definition as wrong event", () => {
    const foreignAward: CheckInAward = { ...award, definitionAddress: `30009:${ADMIN}:other-ticket` };
    expect(validate(makePresentation(), context({ awards: [foreignAward] }))).toEqual({
      ok: false,
      reason: "wrong_event",
    });
  });

  it("rejects a payload whose definition address does not match the award", () => {
    const raw = makePresentation({
      tags: [
        ["p", HOLDER],
        ["e", AWARD_ID],
        ["a", `30009:${ADMIN}:other-ticket`],
        ["event", EVENT_ID],
        ["expiration", String(NOW + 3600)],
      ],
    });
    expect(validate(raw)).toEqual({ ok: false, reason: "wrong_award" });
  });

  it("rejects an award from an untrusted issuer", () => {
    const forged: CheckInAward = { ...award, issuerPubkey: STRANGER };
    expect(validate(makePresentation(), context({ awards: [forged] }))).toEqual({
      ok: false,
      reason: "untrusted_issuer",
    });
  });

  it("rejects a revoked award, but only when the revocation is trusted", () => {
    const revoked = context({ revocations: [{ authorPubkey: ADMIN, references: [AWARD_ID] }] });
    expect(validate(makePresentation(), revoked)).toEqual({ ok: false, reason: "revoked" });

    const untrustedRevocation = context({ revocations: [{ authorPubkey: STRANGER, references: [AWARD_ID] }] });
    expect(validate(makePresentation(), untrustedRevocation).ok).toBe(true);
  });

  it("rejects an already fulfilled award as already checked in", () => {
    const result = validate(
      makePresentation(),
      context({
        statuses: [{ authorPubkey: ADMIN, contextKey: AWARD_ID, status: "fulfilled", context: "event" }],
      }),
    );
    expect(result).toEqual({ ok: false, reason: "already_checked_in" });
  });

  it("does not count fulfilled statuses from untrusted authors or order contexts", () => {
    const result = validate(
      makePresentation(),
      context({
        statuses: [
          { authorPubkey: STRANGER, contextKey: AWARD_ID, status: "fulfilled", context: "event" },
          { authorPubkey: ADMIN, contextKey: AWARD_ID, status: "fulfilled", context: "order" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("treats a locally fulfilled award as already checked in before the relay echo", () => {
    const result = validate(makePresentation(), context({ locallyFulfilledAwardIds: new Set([AWARD_ID]) }));
    expect(result).toEqual({ ok: false, reason: "already_checked_in" });
  });

  it("honors remaining uses for multi-use awards", () => {
    const pass: CheckInAward = { ...award, maxUses: 2 };
    const oneUsed = context({
      awards: [pass],
      statuses: [{ authorPubkey: ADMIN, contextKey: AWARD_ID, status: "fulfilled", context: "event" }],
    });
    expect(validate(makePresentation(), oneUsed).ok).toBe(true);
  });

  it("provides guest-safe wording for every rejection class", () => {
    expect(REJECTION_MESSAGE.already_checked_in).toBe("Already checked in");
    expect(REJECTION_MESSAGE.wrong_event).toContain("different event");
    expect(REJECTION_MESSAGE.expired).toContain("expired");
    expect(REJECTION_MESSAGE.invalid_signature).toContain("Invalid signature");
  });
});
