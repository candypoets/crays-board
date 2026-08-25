import { eventContextKey } from "@/access/nip97";
import {
  awardIssuerValid,
  definitionAuthorTrusted,
  revocationSignerValid,
  type CommunityTrust,
} from "@/access/trust";

import {
  latestStatusAtContext,
  type CheckInAward,
  type CheckInRevocation,
  type CheckInStatus,
} from "./presentation";

/**
 * Pure check-in projection fold (NIP-97, spec of record ~/nips/97.md). Selects
 * the active calendar event and derives the expected/checked-in counts from
 * relay truth. Synchronous and fully unit-testable; the subscription
 * coordinator in useCheckIn.ts only extracts plain inputs at the worker
 * boundary and calls this.
 */

export type CalendarEventRecord = {
  /** 31923 coordinate (`31923:<author>:<d>`) — the check-in context presentations bind to. */
  address: string;
  authorPubkey: string;
  title?: string;
  /** Unix start time, when the event carries a valid `start` tag. */
  start?: number;
  createdAt: number;
};

/**
 * A 30402 ticket definition: a NIP-99 listing linked to a calendar event
 * (`a` tag), which makes it a NIP-97 `event_access` entitlement.
 */
export type TicketDefinitionRecord = {
  /** 30402 address (`30402:<author>:<d>`). */
  address: string;
  authorPubkey: string;
  /** The calendar event coordinate this ticket admits to. */
  eventAddress: string;
  /** Well-formed `price` tag — the badge issuer may award sellable definitions only. */
  sellable: boolean;
  /** Resolved uses per award (`max_uses`; 30402 defaults to 1). */
  maxUses: number;
  createdAt: number;
};

export type CheckInAwardRecord = {
  id: string;
  issuerPubkey: string;
  definitionAddress: string;
  holderPubkey: string;
  createdAt: number;
  /** NIP-40 expiration, when present. */
  expiresAt?: number;
};

export type CheckInProjection = {
  expected: number;
  checkedIn: number;
};

/**
 * The check-in screen operates on one event at a time. Pick the nearest
 * upcoming event by start time; when everything is in the past or undated,
 * fall back to the most recently published event (deterministic by address).
 */
export function selectActiveEvent(events: CalendarEventRecord[], now: number): CalendarEventRecord | undefined {
  const upcoming = events
    .filter((event) => event.start !== undefined && event.start >= now)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.address < b.address ? -1 : 1));
  if (upcoming.length > 0) return upcoming[0];
  return [...events].sort(
    (a, b) => b.createdAt - a.createdAt || (a.address > b.address ? -1 : a.address < b.address ? 1 : 0),
  )[0];
}

function isRevoked(award: CheckInAwardRecord, revocations: CheckInRevocation[], trust: CommunityTrust): boolean {
  return revocations.some(
    (revocation) =>
      revocationSignerValid(revocation.authorPubkey, award.issuerPubkey, trust) &&
      revocation.references.includes(award.id),
  );
}

/**
 * Expected attendees, resolved to the award facts presentation validation
 * needs: awards referencing a ticket definition for the active event — or
 * the event coordinate directly for free-admission grants, where the event
 * itself is the (non-sellable, single-admission) definition — issued per the
 * NIP-97 issuance rules, unexpired, and unrevoked.
 */
export function expectedEventAwards({
  event,
  awards,
  definitions,
  revocations,
  trust,
  now,
}: {
  event: CalendarEventRecord;
  awards: CheckInAwardRecord[];
  definitions: ReadonlyMap<string, TicketDefinitionRecord>;
  revocations: CheckInRevocation[];
  trust: CommunityTrust;
  now: number;
}): CheckInAward[] {
  const eligible: CheckInAward[] = [];
  for (const award of awards) {
    const direct = award.definitionAddress === event.address;
    const definition = direct ? undefined : definitions.get(award.definitionAddress);
    if (!direct) {
      if (!definition || definition.eventAddress !== event.address) continue;
      if (!definitionAuthorTrusted(definition.authorPubkey, trust)) continue;
    }
    // Direct awards reference the calendar event itself: sellable=false, so
    // awardIssuerValid admits anchor admins only.
    const sellable = definition?.sellable ?? false;
    if (!awardIssuerValid({ issuer: award.issuerPubkey, sellable, trust })) continue;
    if (award.expiresAt !== undefined && award.expiresAt <= now) continue;
    if (isRevoked(award, revocations, trust)) continue;
    eligible.push({
      id: award.id,
      issuerPubkey: award.issuerPubkey,
      definitionAddress: award.definitionAddress,
      holderPubkey: award.holderPubkey,
      createdAt: award.createdAt,
      maxUses: definition?.maxUses ?? 1,
      sellable,
    });
  }
  return eligible;
}

/**
 * Expected = valid awards for the active event (see expectedEventAwards).
 * Checked in = those whose latest trusted status at the event's fulfillment
 * context (`event:<coordinate>`) is `fulfilled`. Statuses in other contexts,
 * untrusted signers, and awards for other events never inflate either count.
 */
export function projectCheckIn({
  event,
  awards,
  definitions,
  statuses,
  revocations,
  trust,
  now,
}: {
  event: CalendarEventRecord;
  awards: CheckInAwardRecord[];
  definitions: ReadonlyMap<string, TicketDefinitionRecord>;
  statuses: CheckInStatus[];
  revocations: CheckInRevocation[];
  trust: CommunityTrust;
  now: number;
}): CheckInProjection {
  const eligible = expectedEventAwards({ event, awards, definitions, revocations, trust, now });
  const contextKey = eventContextKey(event.address);
  return {
    expected: eligible.length,
    checkedIn: eligible.filter(
      (award) => latestStatusAtContext(award, contextKey, statuses, trust)?.status === "fulfilled",
    ).length,
  };
}
