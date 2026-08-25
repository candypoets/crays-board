import { definitionAuthorTrusted, type CommunityTrust } from "@/access/trust";

import { calendarEventAddress, type RsvpStatus } from "./protocol";

/**
 * Pure calendar/RSVP projection fold per PRD §8.6 and EVENT-08, on NIP-97
 * trust (spec of record: ~/nips/97.md). Everything here is synchronous and
 * fully unit-testable; the subscription coordinator in useEvents.ts only
 * extracts plain inputs from worker events and calls this.
 */

export type CalendarEventInput = {
  id: string;
  /** Event author (staff key). */
  pubkey: string;
  /** `d` tag. */
  identifier: string;
  title?: string;
  summary?: string;
  /** Unix seconds from the `start` tag. */
  start?: number;
  /** Unix seconds from the `end` tag; absent means a point-in-time event. */
  end?: number;
  location?: string;
  /** Positive capacity, when the `capacity` tag is present. */
  capacity?: number;
  image?: string;
  createdAt: number;
};

export type RsvpInput = {
  id: string;
  /** RSVP author = the attendee. */
  attendeePubkey: string;
  /** `a` tag referencing `31923:<author>:<d>`. */
  eventAddress: string;
  status: RsvpStatus;
  createdAt: number;
};

export type RsvpCounts = {
  accepted: number;
  tentative: number;
  declined: number;
};

export type BoardEvent = {
  /** `31923:<author>:<d>`. */
  address: string;
  id: string;
  pubkey: string;
  identifier: string;
  title: string;
  summary?: string;
  location?: string;
  capacity?: number;
  image?: string;
  start: number;
  end: number;
  isPast: boolean;
  rsvps: RsvpCounts;
  createdAt: number;
};

/** §6.6-style resolution: latest by created_at; ties break by higher event id. */
function isNewer(id: string, createdAt: number, current: { id: string; createdAt: number }): boolean {
  return createdAt > current.createdAt || (createdAt === current.createdAt && id > current.id);
}

/**
 * Projects the Board's event list.
 *
 * - Only events from trusted definition authors count (EVENT-08 on NIP-97
 *   trust: anchor admins plus the community root key; untrusted events are
 *   never rendered as operational truth). Addressable events resolve as the
 *   latest per `31923:<author>:<d>`.
 * - An event missing a `d`, a title, or a usable `start` is malformed and
 *   skipped rather than rendered half-broken.
 * - RSVPs are counted latest-per-attendee per event address (NIP-52: only
 *   the latest response per attendee/event counts). RSVPs are attendee-
 *   published and deliberately NOT gated by anchor trust. Duplicates,
 *   wrong-event `a` tags, and unknown statuses never move the totals.
 *
 * Venue binding is owned by the caller: only events learned from the active
 * venue relay reach this fold.
 */
export function projectEvents({
  events,
  rsvps,
  trust,
  now,
}: {
  events: CalendarEventInput[];
  rsvps: RsvpInput[];
  trust: CommunityTrust;
  now: number;
}): BoardEvent[] {
  const latestByAddress = new Map<string, CalendarEventInput>();
  for (const event of events) {
    if (!definitionAuthorTrusted(event.pubkey, trust)) continue;
    if (!event.identifier) continue;
    const address = calendarEventAddress(event.pubkey, event.identifier);
    const previous = latestByAddress.get(address);
    if (previous && !isNewer(event.id, event.createdAt, previous)) continue;
    latestByAddress.set(address, event);
  }

  // Latest RSVP per attendee per event address.
  const latestRsvps = new Map<string, RsvpInput>();
  for (const rsvp of rsvps) {
    if (!rsvp.eventAddress || !rsvp.attendeePubkey) continue;
    const key = `${rsvp.eventAddress}:${rsvp.attendeePubkey}`;
    const previous = latestRsvps.get(key);
    if (previous && !isNewer(rsvp.id, rsvp.createdAt, previous)) continue;
    latestRsvps.set(key, rsvp);
  }

  const countsByAddress = new Map<string, RsvpCounts>();
  for (const rsvp of latestRsvps.values()) {
    const counts = countsByAddress.get(rsvp.eventAddress) ?? { accepted: 0, tentative: 0, declined: 0 };
    counts[rsvp.status] += 1;
    countsByAddress.set(rsvp.eventAddress, counts);
  }

  const projected: BoardEvent[] = [];
  for (const [address, event] of latestByAddress) {
    if (!event.title || !event.start || !Number.isSafeInteger(event.start) || event.start <= 0) continue;
    const end = event.end && event.end > event.start ? event.end : event.start;
    projected.push({
      address,
      id: event.id,
      pubkey: event.pubkey,
      identifier: event.identifier,
      title: event.title,
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...(event.capacity !== undefined ? { capacity: event.capacity } : {}),
      ...(event.image ? { image: event.image } : {}),
      start: event.start,
      end,
      isPast: end < now,
      rsvps: countsByAddress.get(address) ?? { accepted: 0, tentative: 0, declined: 0 },
      createdAt: event.createdAt,
    });
  }

  // Upcoming first, soonest first; then past, most recent first.
  return projected.sort((a, b) => {
    if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
    return a.isPast ? b.start - a.start : a.start - b.start;
  });
}

export type EventTab = "upcoming" | "past" | "all";

/** Upcoming/Past/All tab filter over the projected list. */
export function filterEvents(events: BoardEvent[], tab: EventTab, search: string): BoardEvent[] {
  const query = search.trim().toLowerCase();
  return events.filter((event) => {
    if (tab === "upcoming" && event.isPast) return false;
    if (tab === "past" && !event.isPast) return false;
    if (query && !event.title.toLowerCase().includes(query) && !(event.summary ?? "").toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}
