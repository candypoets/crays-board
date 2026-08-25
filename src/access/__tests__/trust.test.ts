/// <reference types="jest" />

import {
  awardIssuerValid,
  definitionAuthorTrusted,
  fetchRelayRootPubkey,
  nip11UrlForRelay,
  parseNip11RootPubkey,
  resolveFulfillmentRoleHolders,
  revocationSignerValid,
  statusSignerValid,
  trustFromAnchor,
  trustWithFulfillmentRoles,
  type CommunityTrust,
} from "@/access/trust";

const ROOT = "a".repeat(64);
const ADMIN = "b".repeat(64);
const ISSUER = "c".repeat(64);
const HOLDER = "d".repeat(64);
const STRANGER = "f".repeat(64);

const trust: CommunityTrust = {
  rootPubkey: ROOT,
  admins: new Set([ADMIN]),
  badgeIssuer: ISSUER,
};

describe("trustFromAnchor", () => {
  it("derives the admin set and badge issuer from the anchor", () => {
    expect(
      trustFromAnchor({
        id: "e".repeat(64),
        pubkey: ROOT,
        admins: [ADMIN, ROOT],
        badgeIssuer: ISSUER,
        name: "Skyline",
        description: "",
        createdAt: 100,
      }),
    ).toEqual({ rootPubkey: ROOT, admins: new Set([ADMIN, ROOT]), badgeIssuer: ISSUER });
  });

  it("omits the badge issuer when the anchor has none", () => {
    const resolved = trustFromAnchor({
      id: "e".repeat(64),
      pubkey: ROOT,
      admins: [ADMIN],
      name: "",
      description: "",
      createdAt: 100,
    });
    expect(resolved.badgeIssuer).toBeUndefined();
  });
});

describe("definitionAuthorTrusted", () => {
  it("trusts anchor admins and the root key, nobody else", () => {
    expect(definitionAuthorTrusted(ADMIN, trust)).toBe(true);
    expect(definitionAuthorTrusted(ROOT, trust)).toBe(true);
    expect(definitionAuthorTrusted(ISSUER, trust)).toBe(false);
    expect(definitionAuthorTrusted("f".repeat(64), trust)).toBe(false);
  });
});

describe("nip11UrlForRelay", () => {
  it("maps websocket URLs to their HTTP NIP-11 endpoint", () => {
    expect(nip11UrlForRelay("ws://relay.example.com:7777")).toBe("http://relay.example.com:7777/");
    expect(nip11UrlForRelay("wss://relay.example.com/relay")).toBe("https://relay.example.com/relay");
  });

  it("rejects non-websocket relay URLs", () => {
    expect(() => nip11UrlForRelay("https://relay.example.com")).toThrow();
  });
});

describe("parseNip11RootPubkey", () => {
  it("accepts a 64-hex pubkey", () => {
    expect(parseNip11RootPubkey({ pubkey: ROOT, name: "relay" })).toBe(ROOT);
  });

  it("rejects missing or malformed pubkeys", () => {
    expect(parseNip11RootPubkey({})).toBeUndefined();
    expect(parseNip11RootPubkey({ pubkey: "npub1..." })).toBeUndefined();
    expect(parseNip11RootPubkey(null)).toBeUndefined();
  });
});

describe("fetchRelayRootPubkey", () => {
  it("fetches and validates the relay document", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ pubkey: ROOT }),
    })) as unknown as typeof fetch;
    await expect(fetchRelayRootPubkey("wss://relay.example.com", fetchImpl)).resolves.toBe(ROOT);
    expect(fetchImpl).toHaveBeenCalledWith("https://relay.example.com/", {
      headers: { accept: "application/nostr+json" },
    });
  });

  it("throws when the relay has no valid community key", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ name: "no key here" }),
    })) as unknown as typeof fetch;
    await expect(fetchRelayRootPubkey("wss://relay.example.com", fetchImpl)).rejects.toThrow();
  });
});

describe("awardIssuerValid", () => {
  it("allows anchor admins for any definition", () => {
    expect(awardIssuerValid({ issuer: ADMIN, sellable: false, trust })).toBe(true);
    expect(awardIssuerValid({ issuer: ADMIN, sellable: true, trust })).toBe(true);
  });

  it("allows the badge issuer only for sellable definitions", () => {
    expect(awardIssuerValid({ issuer: ISSUER, sellable: true, trust })).toBe(true);
    expect(awardIssuerValid({ issuer: ISSUER, sellable: false, trust })).toBe(false);
  });

  it("rejects unrelated signers", () => {
    expect(awardIssuerValid({ issuer: "f".repeat(64), sellable: true, trust })).toBe(false);
  });
});

describe("statusSignerValid", () => {
  it("allows anchor admins, the badge issuer, and resolved fulfillment staff", () => {
    const delegated = { ...trust, fulfillmentRoleHolders: new Set([HOLDER]) };
    expect(statusSignerValid(ADMIN, trust)).toBe(true);
    expect(statusSignerValid(ISSUER, trust)).toBe(true);
    expect(statusSignerValid(HOLDER, delegated)).toBe(true);
    expect(statusSignerValid(STRANGER, delegated)).toBe(false);
  });
});

describe("resolveFulfillmentRoleHolders", () => {
  const roleAddress = `30009:${ADMIN}:staff`;
  const definition = {
    address: roleAddress,
    id: "1".repeat(64),
    authorPubkey: ADMIN,
    permissions: [{ capability: "37237", access: "write" as const }],
    sellable: false,
    createdAt: 100,
  };
  const award = {
    id: "2".repeat(64),
    issuerPubkey: ADMIN,
    definitionAddress: roleAddress,
    holderPubkey: HOLDER,
  };

  it("derives a live 37237/write role holder and attaches it to trust", () => {
    const inputs = { definitions: [definition], awards: [award], revocations: [], now: 200 };
    expect(resolveFulfillmentRoleHolders({ ...inputs, trust })).toEqual(new Set([HOLDER]));
    expect(statusSignerValid(HOLDER, trustWithFulfillmentRoles(trust, inputs))).toBe(true);
  });

  it("rejects expired, revoked, issuer-signed, sellable, and unrelated grants", () => {
    const expired = { ...award, id: "3".repeat(64), expiresAt: 200 };
    const issuerSigned = { ...award, id: "4".repeat(64), issuerPubkey: ISSUER };
    const unrelated = { ...award, id: "5".repeat(64), definitionAddress: `30009:${ADMIN}:other` };
    const revoked = { ...award, id: "6".repeat(64) };
    const holders = resolveFulfillmentRoleHolders({
      definitions: [definition, { ...definition, address: unrelated.definitionAddress, sellable: true }],
      awards: [expired, issuerSigned, unrelated, revoked],
      revocations: [{ authorPubkey: ADMIN, references: [revoked.id] }],
      trust,
      now: 200,
    });
    expect(holders).toEqual(new Set());
  });
});

describe("revocationSignerValid", () => {
  it("allows the award issuer or an anchor admin", () => {
    expect(revocationSignerValid(ISSUER, ISSUER, trust)).toBe(true);
    expect(revocationSignerValid(ADMIN, ISSUER, trust)).toBe(true);
    expect(revocationSignerValid("f".repeat(64), ISSUER, trust)).toBe(false);
  });
});
