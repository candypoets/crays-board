import type { EventTemplate } from "nostr-tools";

/**
 * NIP-52 calendar contract for the events slice (PRD §8.6,
 * docs/architecture/venue-commerce-nip.md §2).
 *
 * - Calendar event (31923): addressable timed event, staff-owned. The
 *   open/free writer publishes exactly the tags in buildCalendarEvent.
 * - RSVP (31925): one attendee's response; only the latest response per
 *   attendee/event counts (fold.ts owns that projection).
 */
export const KIND_CALENDAR_EVENT = 31923;
export const KIND_RSVP = 31925;

export type RsvpStatus = "accepted" | "tentative" | "declined";
export const RSVP_STATUSES: ReadonlySet<string> = new Set(["accepted", "tentative", "declined"]);

/** Address a calendar event is known by: `31923:<author>:<d>`. */
export function calendarEventAddress(authorPubkey: string, identifier: string): string {
  return `${KIND_CALENDAR_EVENT}:${authorPubkey}:${identifier}`;
}

export type CalendarEventParams = {
  /** `d` tag: stable identifier, unique per event draft. */
  identifier: string;
  title: string;
  summary: string;
  /** Unix seconds, local wall time chosen in the draft. */
  start: number;
  end: number;
};

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Builds the exact kind 31923 tag set for an open/free event in this slice:
 * `d`, `title`, `start`, `end`, `summary` — no more, no less (the restricted/
 * paid slices add required_badge/price tags later). Content stays empty;
 * everything guests render comes from tags.
 */
export function buildCalendarEvent({ identifier, title, summary, start, end }: CalendarEventParams): EventTemplate {
  const trimmedTitle = title.trim();
  if (!identifier.trim()) throw new Error("The event identifier is missing.");
  if (trimmedTitle.length < 2 || trimmedTitle.length > 120) {
    throw new Error("The event title must be between 2 and 120 characters.");
  }
  if (summary.trim().length > 200) throw new Error("The event summary must be at most 200 characters.");
  if (!isPositiveSafeInteger(start) || !isPositiveSafeInteger(end)) {
    throw new Error("The event schedule is not a valid unix timestamp.");
  }
  if (end <= start) throw new Error("The event must end after it starts.");

  return {
    kind: KIND_CALENDAR_EVENT,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [
      ["d", identifier],
      ["title", trimmedTitle],
      ["start", String(start)],
      ["end", String(end)],
      ["summary", summary.trim()],
    ],
  };
}
