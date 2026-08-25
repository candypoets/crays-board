import type { EventTemplate } from "nostr-tools";

import { KIND_BADGE_DEFINITION, KIND_VENUE_PROFILE } from "@/nostr/protocol";

/**
 * Settings write contract (PRD §8.9, QA_WORKFLOWS PROFILE/MEMBER/ROOM).
 *
 * - Venue profile: kind 30078 with d=nuts-community-profile, republished in
 *   place to the venue relay only.
 * - Memberships: NIP-97 kind 30009 definitions (t=membership topic, NIP-99
 *   price tag) edited in place — every update reuses the stable d.
 * - Room manifest: read-only in this slice (life.crays/room/v1, published by
 *   the venue authority out of band).
 *
 * Everything here is pure and fully unit-testable; screens sign the returned
 * template and publish it through src/nostr/publish.ts.
 */
export const VENUE_PROFILE_D = "nuts-community-profile";
export const ROOM_MANIFEST_SCHEMA = "life.crays/room/v1";
export const ROOM_MANIFEST_D_PREFIX = "life.crays/room/v1/";

/** PRD §8.9: venue description is capped at 200 characters. */
export const MAX_DESCRIPTION_LENGTH = 200;

export const MEMBERSHIP_PERIODS = ["one-time", "monthly", "yearly"] as const;
export type MembershipPeriod = (typeof MEMBERSHIP_PERIODS)[number];

export const AVAILABILITIES = ["available", "unavailable", "archived"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export type ProfileDraft = {
  hospitalityType: string;
  description: string;
  menuUrl: string;
  bookingUrl: string;
};

/** Returns the first validation error, or null when the draft may be published. */
export function validateProfileDraft(draft: ProfileDraft): string | null {
  if (!draft.hospitalityType.trim()) return "Choose a hospitality type.";
  if (draft.hospitalityType.trim().length > 40) return "The hospitality type is too long.";
  if (draft.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    return `The description is limited to ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  if (draft.menuUrl.trim() && !isHttpUrl(draft.menuUrl.trim())) {
    return "The menu link must be a valid http(s) URL.";
  }
  if (draft.bookingUrl.trim() && !isHttpUrl(draft.bookingUrl.trim())) {
    return "The booking link must be a valid http(s) URL.";
  }
  return null;
}

/**
 * Builds the kind 30078 venue profile, always at the stable
 * d=nuts-community-profile so the save resolves as the latest addressable
 * event (PROFILE-01). The venue display name is preserved from the previous
 * profile — this editor does not rename the venue.
 */
export function buildVenueProfile(draft: ProfileDraft, venueName?: string): EventTemplate {
  const invalid = validateProfileDraft(draft);
  if (invalid) throw new Error(invalid);
  const tags: string[][] = [
    ["d", VENUE_PROFILE_D],
    ["type", draft.hospitalityType.trim()],
  ];
  if (venueName?.trim()) tags.push(["name", venueName.trim()]);
  if (draft.description.trim()) tags.push(["about", draft.description.trim()]);
  if (draft.menuUrl.trim()) tags.push(["menu_url", draft.menuUrl.trim()]);
  if (draft.bookingUrl.trim()) tags.push(["booking_url", draft.bookingUrl.trim()]);
  return {
    kind: KIND_VENUE_PROFILE,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags,
  };
}

export type MembershipDraft = {
  /** Stable definition identifier — edits must reuse it (NIP-01 addressable update rule). */
  d: string;
  name: string;
  description: string;
  period: MembershipPeriod;
  price: string;
  currency: string;
  availability: Availability;
};

/** Returns the first validation error, or null when the draft may be published. */
export function validateMembershipDraft(draft: MembershipDraft): string | null {
  if (!draft.d.trim()) return "The plan is missing its stable identifier.";
  if (draft.name.trim().length < 2) return "The plan name needs at least 2 characters.";
  if (!PRICE_PATTERN.test(draft.price.trim()) || Number(draft.price) <= 0) {
    return "The price must be a positive amount.";
  }
  if (!CURRENCY_PATTERN.test(draft.currency.trim())) {
    return "The currency must be a three-letter ISO code (e.g. EUR).";
  }
  if (!MEMBERSHIP_PERIODS.includes(draft.period)) return "Choose a billing period.";
  if (!AVAILABILITIES.includes(draft.availability)) return "Unknown availability.";
  return null;
}

/**
 * Builds the NIP-97 membership definition: the membership `t` topic, a NIP-99
 * `price` tag (amount, currency, `month`/`year` recurrence — absent for
 * one-time plans), and availability. Callers pass the existing d for in-place
 * edits (MEMBER-02).
 */
export function buildMembershipDefinition(draft: MembershipDraft): EventTemplate {
  const invalid = validateMembershipDraft(draft);
  if (invalid) throw new Error(invalid);
  const recurrence = draft.period === "monthly" ? "month" : draft.period === "yearly" ? "year" : undefined;
  const price = ["price", draft.price.trim(), draft.currency.trim().toUpperCase()];
  if (recurrence) price.push(recurrence);
  const tags: string[][] = [
    ["d", draft.d],
    ["t", "membership"],
    ["name", draft.name.trim()],
    price,
    ["availability", draft.availability],
  ];
  if (draft.description.trim()) tags.push(["description", draft.description.trim()]);
  return {
    kind: KIND_BADGE_DEFINITION,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags,
  };
}
