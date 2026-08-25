import type { EventTemplate } from "nostr-tools";

import { buildPermissionTag } from "@/access/nip97";
import { KIND_AWARD, KIND_BADGE_DEFINITION } from "@/nostr/protocol";

import { PERMISSIONS, PERMISSION_CAPABILITIES, isPermission, type Permission } from "./fold";

/**
 * People/roles write-side builders (NIP-97, spec of record ~/nips/97.md;
 * PRD §8.7). Feature-local per the swarm contract — src/nostr/protocol.ts
 * keeps the order path only. Every builder validates before producing a
 * template: invalid identity, past expiry, or unknown permissions produce no
 * write (ROLE-03).
 */

export const KIND_DELETION = 5;

const HEX_64 = /^[0-9a-f]{64}$/i;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isDefinitionAddress(value: string): boolean {
  const [kind, author, ...d] = value.split(":");
  return kind === String(KIND_BADGE_DEFINITION) && HEX_64.test(author ?? "") && d.join(":").length > 0;
}

/**
 * Membership revocation (PEOPLE-04): kind 5 referencing the exact award id
 * via an `e` tag (kind 8 is a regular event), with the NIP-09 `k` hint.
 * The optional reason rides in content; the contract only requires the
 * reference.
 */
export function buildRevocation({ awardId, reason }: { awardId: string; reason?: string }): EventTemplate {
  if (!HEX_64.test(awardId)) throw new Error("The revocation target is not a valid award event id.");
  return {
    kind: KIND_DELETION,
    created_at: nowSeconds(),
    content: reason?.trim() ?? "",
    tags: [
      ["e", awardId],
      ["k", String(KIND_AWARD)],
    ],
  };
}

export type RoleDefinitionParams = {
  /** Stable `d`; editing reuses the same d (addressable update rule). */
  d: string;
  name: string;
  description?: string;
  permissions: Permission[];
};

/**
 * Role definition (NIP-97 §Definitions): kind 30009 with `t=role`, name,
 * optional description, and one NIP-97 `permission` tag per selected
 * permission in canonical matrix order.
 */
export function buildRoleDefinition({ d, name, description, permissions }: RoleDefinitionParams): EventTemplate {
  if (!d.trim()) throw new Error("The role needs a stable identifier.");
  if (name.trim().length < 2) throw new Error("The role name needs at least 2 characters.");
  for (const permission of permissions) {
    if (!isPermission(permission)) throw new Error(`Unknown permission: ${permission}`);
  }
  const ordered = PERMISSIONS.filter((permission) => permissions.includes(permission));
  return {
    kind: KIND_BADGE_DEFINITION,
    created_at: nowSeconds(),
    content: "",
    tags: [
      ["d", d],
      ["t", "role"],
      ["name", name.trim()],
      ...(description?.trim() ? [["description", description.trim()] as string[]] : []),
      ...ordered.map((permission) => buildPermissionTag(PERMISSION_CAPABILITIES[permission])),
    ],
  };
}

export type RoleAssignmentParams = {
  /** `30009:<role-author>:<d>` address of the role definition. */
  roleAddress: string;
  holderPubkey: string;
  /** NIP-40 expiration (unix seconds); omit for a permanent assignment. */
  expiresAt?: number;
  /** Injectable clock for validation/tests. */
  now?: number;
};

/**
 * Role assignment (NIP-97 §Awards, ROLE-03): kind 8 with exact `a`/`p`/
 * optional expiration, plus the spec-required `t` query hints (definition
 * kind and family topic).
 */
export function buildRoleAssignment({ roleAddress, holderPubkey, expiresAt, now }: RoleAssignmentParams): EventTemplate {
  if (!isDefinitionAddress(roleAddress)) throw new Error("The role does not have a valid definition address.");
  if (!HEX_64.test(holderPubkey)) throw new Error("The assignee is not a valid pubkey.");
  const reference = now ?? nowSeconds();
  if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= reference)) {
    throw new Error("The assignment expiry must be in the future.");
  }
  return {
    kind: KIND_AWARD,
    created_at: nowSeconds(),
    content: "",
    tags: [
      ["a", roleAddress],
      ["p", holderPubkey.toLowerCase()],
      ...(expiresAt !== undefined ? [["expiration", String(expiresAt)] as string[]] : []),
      ["t", String(KIND_BADGE_DEFINITION)],
      ["t", "role"],
    ],
  };
}

/** Accepts a 64-char hex pubkey or an npub and returns the lowercase hex key. */
export function resolveAssigneePubkey(input: string): string {
  const candidate = input.trim();
  if (HEX_64.test(candidate)) return candidate.toLowerCase();
  if (/^npub1[02-9ac-hj-np-z]+$/.test(candidate)) {
    const decoded = decodeNpub(candidate);
    if (decoded) return decoded;
  }
  throw new Error("Enter a valid hex pubkey or npub.");
}

/**
 * Parses the optional assignment expiry field: blank means permanent;
 * `YYYY-MM-DD` means end of that day (UTC) and must be in the future.
 */
export function parseExpiryInput(input: string, now?: number): number | undefined {
  const candidate = input.trim();
  if (!candidate) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new Error("Expiry must be a date like 2026-09-30.");
  }
  const expiresAt = Math.floor(Date.parse(`${candidate}T23:59:59Z`) / 1000);
  if (!Number.isSafeInteger(expiresAt)) throw new Error("Expiry must be a date like 2026-09-30.");
  if (expiresAt <= (now ?? nowSeconds())) throw new Error("Expiry must be in the future.");
  return expiresAt;
}

// --- Minimal bech32 (BIP-173) decoding for NIP-19 npubs -------------------
// Local so this module stays dependency-free and unit-testable under jest
// (nostr-tools' runtime deps are ESM-only and outside the jest transform).

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) checksum ^= BECH32_GENERATOR[i] ?? 0;
    }
  }
  return checksum;
}

function bech32HrpExpand(hrp: string): number[] {
  const expanded: number[] = [];
  for (const char of hrp) expanded.push(char.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31);
  return expanded;
}

function convertBits(values: number[], fromBits: number, toBits: number): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;
  for (const value of values) {
    if (value < 0 || value >> fromBits !== 0) return null;
    accumulator = ((accumulator << fromBits) | value) & 0xffffffff;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
    accumulator &= (1 << bits) - 1;
  }
  // No padding allowed on decode; leftover bits must be zero.
  if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) return null;
  return result;
}

/** Decodes a checksummed bech32 npub to the 64-char lowercase hex pubkey. */
export function decodeNpub(npub: string): string | null {
  const separator = npub.lastIndexOf("1");
  if (separator < 1 || separator + 7 > npub.length) return null;
  const hrp = npub.slice(0, separator).toLowerCase();
  if (hrp !== "npub") return null;
  const payload = npub.slice(separator + 1);
  const words: number[] = [];
  for (const char of payload) {
    const index = BECH32_CHARSET.indexOf(char);
    if (index === -1) return null;
    words.push(index);
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...words]) !== 1) return null;
  const bytes = convertBits(words.slice(0, -6), 5, 8);
  if (!bytes || bytes.length !== 32) return null;
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
