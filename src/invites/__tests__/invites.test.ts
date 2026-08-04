/// <reference types="jest" />

import {
  CLAIM_EXPIRY_OPTIONS,
  MAX_REDEMPTION_OPTIONS,
  MEMBERSHIP_DURATION_OPTIONS,
  buildInviteRequestBody,
  buildNip98Template,
  buildRedeemUrl,
  decodeInviteClaims,
  durationLabel,
  expiryLabel,
  fromBase64Url,
  inviteEndpoints,
  inviteLogMarker,
  nip98AuthorizationHeader,
  parseInviteResponse,
  toBase64Url,
  type InviteServiceResponse,
} from "@/invites/invites";

const SERVICE = "http://10.0.2.2:7799";
const RELAY = "ws://10.0.2.2:7777";
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function makeToken(claims: Record<string, unknown>, signature = "c2ln"): string {
  return `${toBase64Url(JSON.stringify(claims))}.${signature}`;
}

const VALID_CLAIMS = {
  v: 1,
  nonce: "nonce-abc",
  badge: "30009:" + "b".repeat(64) + ":members",
  exp: 1_700_000_000,
  badge_exp: 1_707_776_000,
  max: 5,
};

const RESPONSE: InviteServiceResponse = {
  token: makeToken(VALID_CLAIMS),
  expiresAt: VALID_CLAIMS.exp,
  badgeExpiresAt: VALID_CLAIMS.badge_exp,
  maxRedemptions: 5,
};

describe("option contract (INVITE-01)", () => {
  it("offers exactly the PRD §8.8 claim expiry choices", () => {
    expect(CLAIM_EXPIRY_OPTIONS.map((o) => o.seconds)).toEqual([3600, 86400, 604800, 2592000]);
    expect(CLAIM_EXPIRY_OPTIONS.map((o) => o.label)).toEqual(["1 hour", "1 day", "7 days", "30 days"]);
  });

  it("offers exactly the PRD §8.8 membership duration choices", () => {
    expect(MEMBERSHIP_DURATION_OPTIONS.map((o) => o.seconds)).toEqual([null, 2592000, 7776000, 31536000]);
    expect(MEMBERSHIP_DURATION_OPTIONS[0].label).toBe("Permanent");
  });

  it("only offers redemption counts >= 1", () => {
    expect(MAX_REDEMPTION_OPTIONS.every((count) => Number.isSafeInteger(count) && count >= 1)).toBe(true);
  });
});

describe("buildInviteRequestBody", () => {
  it("serializes every expiry/duration combination exactly", () => {
    for (const expiry of CLAIM_EXPIRY_OPTIONS) {
      for (const duration of MEMBERSHIP_DURATION_OPTIONS) {
        const body = buildInviteRequestBody({
          claimExpirySeconds: expiry.seconds,
          membershipDurationSeconds: duration.seconds,
          maxRedemptions: 5,
        });
        const parsed = JSON.parse(body);
        expect(parsed.expires_in_seconds).toBe(expiry.seconds);
        expect(parsed.max_redemptions).toBe(5);
        if (duration.seconds === null) {
          expect("badge_expires_in_seconds" in parsed).toBe(false);
        } else {
          expect(parsed.badge_expires_in_seconds).toBe(duration.seconds);
        }
      }
    }
  });

  it("serializes the QA flow configuration 7d/90d/5 byte-exactly", () => {
    expect(
      buildInviteRequestBody({ claimExpirySeconds: 604800, membershipDurationSeconds: 7776000, maxRedemptions: 5 }),
    ).toBe('{"expires_in_seconds":604800,"badge_expires_in_seconds":7776000,"max_redemptions":5}');
  });

  it("omits badge_expires_in_seconds for permanent membership, key order fixed", () => {
    expect(
      buildInviteRequestBody({ claimExpirySeconds: 3600, membershipDurationSeconds: null, maxRedemptions: 1 }),
    ).toBe('{"expires_in_seconds":3600,"max_redemptions":1}');
  });

  it("rejects invalid redemption counts locally with no request", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        buildInviteRequestBody({ claimExpirySeconds: 3600, membershipDurationSeconds: null, maxRedemptions: bad }),
      ).toThrow(/redemptions/i);
    }
  });

  it("rejects non-positive expiry or duration", () => {
    expect(() =>
      buildInviteRequestBody({ claimExpirySeconds: 0, membershipDurationSeconds: null, maxRedemptions: 1 }),
    ).toThrow(/claim link/i);
    expect(() =>
      buildInviteRequestBody({ claimExpirySeconds: 3600, membershipDurationSeconds: 0, maxRedemptions: 1 }),
    ).toThrow(/membership/i);
  });
});

describe("inviteEndpoints", () => {
  it("posts to the device-reachable URL but binds NIP-98 to the canonical loopback URL", () => {
    const { requestUrl, authUrl } = inviteEndpoints(SERVICE);
    expect(requestUrl).toBe("http://10.0.2.2:7799/invites");
    expect(authUrl).toBe("http://127.0.0.1:7799/invites");
  });

  it("strips trailing slashes and leaves production https URLs untouched", () => {
    expect(inviteEndpoints("https://venue.example/").authUrl).toBe("https://venue.example/invites");
  });

  it("rejects non-http service URLs", () => {
    expect(() => inviteEndpoints("ftp://venue.example")).toThrow(/invalid/i);
  });
});

describe("buildNip98Template (INVITE-02)", () => {
  it("builds a kind 27235 template bound to exact URL, POST method, and payload hash", () => {
    const template = buildNip98Template("http://127.0.0.1:7799/invites", SHA256_EMPTY);
    expect(template.kind).toBe(27235);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["u", "http://127.0.0.1:7799/invites"],
      ["method", "POST"],
      ["payload", SHA256_EMPTY],
    ]);
    expect(Number.isSafeInteger(template.created_at)).toBe(true);
  });

  it("rejects a malformed payload hash", () => {
    expect(() => buildNip98Template("http://x/invites", "nothex")).toThrow(/SHA-256/i);
  });
});

describe("base64url helpers", () => {
  it("encodes UTF-8 to unpadded base64url", () => {
    expect(toBase64Url("hello world")).toBe("aGVsbG8gd29ybGQ");
    expect(toBase64Url("")).toBe("");
    expect(toBase64Url('{"a":1}')).toBe("eyJhIjoxfQ");
    // UTF-8 multibyte round trip
    expect(fromBase64Url(toBase64Url("héllo 🦀"))).toBe("héllo 🦀");
  });

  it("decodes base64url with or without padding", () => {
    expect(fromBase64Url("aGVsbG8gd29ybGQ")).toBe("hello world");
    expect(() => fromBase64Url("!!!")).toThrow(/base64url/i);
  });

  it("wraps the signed event JSON in a Nostr authorization header", () => {
    const json = '{"kind":27235}';
    expect(nip98AuthorizationHeader(json)).toBe(`Nostr ${toBase64Url(json)}`);
  });
});

describe("buildRedeemUrl (INVITE-05)", () => {
  it("opens crays-rn's /invite entry path preserving service, relay, and token", () => {
    const url = buildRedeemUrl({ serviceUrl: SERVICE, relayUrl: RELAY, token: RESPONSE.token });
    expect(url.startsWith("crays://invite?")).toBe(true);
    expect(url).toContain(`service=${encodeURIComponent(SERVICE)}`);
    expect(url).toContain(`relay=${encodeURIComponent(RELAY)}`);
    expect(url).toContain(`token=${encodeURIComponent(RESPONSE.token)}`);
    expect(url).not.toContain("/redeem");
  });

  it("rejects incomplete tokens and invalid addresses", () => {
    expect(() => buildRedeemUrl({ serviceUrl: SERVICE, relayUrl: RELAY, token: "nodot" })).toThrow(/token/i);
    expect(() => buildRedeemUrl({ serviceUrl: SERVICE, relayUrl: "http://x", token: RESPONSE.token })).toThrow(
      /relay/i,
    );
  });
});

describe("parseInviteResponse", () => {
  it("accepts the exact service response shape", () => {
    expect(
      parseInviteResponse({ token: "a.b", expires_at: 100, badge_expires_at: 200, max_redemptions: 5 }),
    ).toEqual({ token: "a.b", expiresAt: 100, badgeExpiresAt: 200, maxRedemptions: 5 });
  });

  it("maps a missing badge expiry (permanent membership) to null", () => {
    const parsed = parseInviteResponse({ token: "a.b", expires_at: 100, max_redemptions: 1 });
    expect(parsed.badgeExpiresAt).toBeNull();
  });

  it("rejects malformed responses", () => {
    expect(() => parseInviteResponse(null)).toThrow();
    expect(() => parseInviteResponse({ token: "nodot", expires_at: 1, max_redemptions: 1 })).toThrow(/token/i);
    expect(() => parseInviteResponse({ token: "a.b", max_redemptions: 1 })).toThrow(/expiry/i);
    expect(() => parseInviteResponse({ token: "a.b", expires_at: 1, max_redemptions: 0 })).toThrow(/redemption/i);
  });
});

describe("decodeInviteClaims and the log marker", () => {
  it("decodes the unsigned claims segment", () => {
    expect(decodeInviteClaims(RESPONSE.token)).toEqual(VALID_CLAIMS);
  });

  it("rejects malformed tokens", () => {
    expect(() => decodeInviteClaims("nodot")).toThrow(/malformed/i);
    expect(() => decodeInviteClaims("!!!.sig")).toThrow(/malformed/i);
    expect(() => decodeInviteClaims(makeToken({ v: 2 }))).toThrow(/unsupported/i);
  });

  it("marker carries claims and service host but never the raw token", () => {
    const marker = inviteLogMarker(RESPONSE, SERVICE);
    expect(marker).toEqual({
      nonce: VALID_CLAIMS.nonce,
      exp: VALID_CLAIMS.exp,
      badge_exp: VALID_CLAIMS.badge_exp,
      max: 5,
      service: "10.0.2.2:7799",
    });
    const serialized = JSON.stringify(marker);
    expect(serialized).not.toContain(RESPONSE.token);
    expect(serialized).not.toContain(RESPONSE.token.split(".")[1]);
    expect(Object.keys(marker)).not.toContain("token");
  });
});

describe("display labels", () => {
  it("labels the configured values", () => {
    expect(expiryLabel(604800)).toBe("7 days");
    expect(durationLabel(null)).toBe("Permanent");
    expect(durationLabel(7776000)).toBe("90 days");
  });
});
