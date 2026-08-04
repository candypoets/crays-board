/**
 * Pure create-event draft logic (EVENT-02/EVENT-03): validation and schedule
 * resolution for the three-step wizard. The wizard keeps one draft object
 * across steps; every rule here is synchronous and unit-testable.
 */

export const EVENT_CATEGORIES = [
  "Gathering",
  "Supper club",
  "Music & listening",
  "Tasting",
  "Workshop",
  "Community",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export type EventDraft = {
  title: string;
  summary: string;
  category: EventCategory;
  /** `YYYY-MM-DD` local calendar date. */
  date: string;
  /** `HH:MM` 24-hour local wall time. */
  startTime: string;
  endTime: string;
  /** Optional capacity text; empty means unlimited. */
  capacity: string;
};

export function emptyDraft(): EventDraft {
  return {
    title: "",
    summary: "",
    category: EVENT_CATEGORIES[0],
    date: "",
    startTime: "",
    endTime: "",
    capacity: "",
  };
}

/** Stable `d` identifier for one draft, generated once when the wizard opens. */
export function newEventIdentifier(): string {
  return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type DraftField = "title" | "summary" | "date" | "startTime" | "endTime" | "capacity";
export type DraftErrors = Partial<Record<DraftField, string>>;

export function validateDetails(draft: EventDraft): DraftErrors {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (title.length < 2) errors.title = "Give the event a title of at least 2 characters.";
  else if (title.length > 120) errors.title = "Keep the title under 120 characters.";
  if (draft.summary.trim().length > 200) errors.summary = "Keep the summary under 200 characters.";
  return errors;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseDate(text: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return { year, month, day };
}

function parseTime(text: string): { hours: number; minutes: number } | null {
  const match = TIME_PATTERN.exec(text.trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function toUnix(date: { year: number; month: number; day: number }, time: { hours: number; minutes: number }): number {
  return Math.floor(new Date(date.year, date.month - 1, date.day, time.hours, time.minutes).getTime() / 1000);
}

export function isValidCapacity(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true; // optional
  if (!/^\d+$/.test(trimmed)) return false;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000;
}

/**
 * EVENT-03: rejects impossible ranges (malformed date/time, end not after
 * start, start in the past) before any publish can happen. Times resolve
 * against the device timezone; the wizard communicates that zone next to the
 * fields. `now` is injectable for deterministic tests.
 */
export function validateSchedule(
  draft: EventDraft,
  now: number = Math.floor(Date.now() / 1000),
): { errors: DraftErrors; start?: number; end?: number } {
  const errors: DraftErrors = {};
  const date = parseDate(draft.date);
  const startTime = parseTime(draft.startTime);
  const endTime = parseTime(draft.endTime);

  if (!date) errors.date = "Use a real date in YYYY-MM-DD format.";
  if (!startTime) errors.startTime = "Use a 24-hour time like 18:00.";
  if (!endTime) errors.endTime = "Use a 24-hour time like 20:00.";
  if (!isValidCapacity(draft.capacity)) errors.capacity = "Capacity must be a positive whole number.";

  if (!date || !startTime || !endTime) return { errors };

  const start = toUnix(date, startTime);
  const end = toUnix(date, endTime);
  if (end <= start) {
    errors.endTime = "The event must end after it starts.";
    return { errors };
  }
  if (start < now) {
    errors.date = "The event must start in the future.";
    return { errors };
  }
  return { errors, start, end };
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.values(errors).some(Boolean);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "Sun, 15 Jan 2027" in the device timezone. */
export function formatEventDate(unix: number): string {
  const date = new Date(unix * 1000);
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "18:00" in the device timezone. */
export function formatEventTime(unix: number): string {
  const date = new Date(unix * 1000);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "Sun, 15 Jan 2027 · 18:00–20:00" for cards and the detail panel. */
export function formatSchedule(start: number, end: number): string {
  const range = `${formatEventTime(start)}–${formatEventTime(end)}`;
  return `${formatEventDate(start)} · ${range}`;
}

/** Device timezone label, honest about the fallback. */
export function localTimezoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "device local time";
  } catch {
    return "device local time";
  }
}
