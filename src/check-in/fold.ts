import type { OrderContext, PublishedOrderStatus } from "@/nostr/protocol";

import type { CheckInRevocation, CheckInStatus } from "./presentation";

/**
 * Pure check-in projection fold (venue-commerce-nip §8, EVENT-10). Selects
 * the active calendar event and derives the expected/checked-in counts from
 * relay truth. Synchronous and fully unit-testable; the subscription
 * coordinator in useCheckIn.ts only extracts plain inputs at the worker
 * boundary and calls this.
 */

export type CalendarEventRecord = {
  /** 31923 event id — the check-in context presentations bind to. */
  id: string;
  title?: string;
  /** Unix start time, when the event carries a valid `start` tag. */
  start?: number;
  /** Entrance-badge definition address (`a` tag → 30009 event_access). */
  accessAddress: string;
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
 * fall back to the most recently published event (deterministic by id).
 */
export function selectActiveEvent(events: CalendarEventRecord[], now: number): CalendarEventRecord | undefined {
  const upcoming = events
    .filter((event) => event.start !== undefined && event.start >= now)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.id < b.id ? -1 : 1));
  if (upcoming.length > 0) return upcoming[0];
  return [...events].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id > b.id ? -1 : a.id < b.id ? 1 : 0),
  )[0];
}

function isRevoked(awardId: string, revocations: CheckInRevocation[], trustedIssuers: ReadonlySet<string>): boolean {
  return revocations.some(
    (revocation) => trustedIssuers.has(revocation.authorPubkey) && revocation.references.includes(awardId),
  );
}

function hasFulfilledCheckIn(
  awardId: string,
  statuses: CheckInStatus[],
  trustedIssuers: ReadonlySet<string>,
): boolean {
  return statuses.some(
    (status) =>
      status.contextKey === awardId &&
      status.status === ("fulfilled" satisfies PublishedOrderStatus) &&
      status.context === ("event" satisfies OrderContext) &&
      trustedIssuers.has(status.authorPubkey),
  );
}

/**
 * Expected = trusted, unexpired, unrevoked awards for the event's
 * entrance-badge definition. Checked in = those with a trusted fulfilled
 * event-context status (§7: a fulfilled status consumes the single use).
 * Untrusted issuers, expired/revoked awards, and awards for other
 * definitions never inflate either count.
 */
export function projectCheckIn({
  event,
  awards,
  statuses,
  revocations,
  trustedIssuers,
  now,
}: {
  event: CalendarEventRecord;
  awards: CheckInAwardRecord[];
  statuses: CheckInStatus[];
  revocations: CheckInRevocation[];
  trustedIssuers: ReadonlySet<string>;
  now: number;
}): CheckInProjection {
  const eligible = awards.filter(
    (award) =>
      award.definitionAddress === event.accessAddress &&
      trustedIssuers.has(award.issuerPubkey) &&
      (award.expiresAt === undefined || award.expiresAt > now) &&
      !isRevoked(award.id, revocations, trustedIssuers),
  );
  return {
    expected: eligible.length,
    checkedIn: eligible.filter((award) => hasFulfilledCheckIn(award.id, statuses, trustedIssuers)).length,
  };
}
