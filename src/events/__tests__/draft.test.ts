/// <reference types="jest" />

import {
  emptyDraft,
  formatEventDate,
  formatEventTime,
  hasErrors,
  isValidCapacity,
  newEventIdentifier,
  validateDetails,
  validateSchedule,
  type EventDraft,
} from "@/events/draft";

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    ...emptyDraft(),
    title: "QA Event",
    summary: "A QA gathering.",
    date: "2027-01-15",
    startTime: "18:00",
    endTime: "20:00",
    ...overrides,
  };
}

/** Fixed "now" that keeps the 2027 fixture safely in the future. */
const NOW = Math.floor(new Date(2026, 0, 1).getTime() / 1000);

describe("details-step validation", () => {
  it("accepts a valid title and summary", () => {
    expect(hasErrors(validateDetails(draft()))).toBe(false);
  });

  it("requires a title of at least 2 characters", () => {
    expect(validateDetails(draft({ title: " " })).title).toBeTruthy();
    expect(validateDetails(draft({ title: "x" })).title).toBeTruthy();
  });

  it("bounds the title and summary lengths", () => {
    expect(validateDetails(draft({ title: "x".repeat(121) })).title).toBeTruthy();
    expect(validateDetails(draft({ summary: "x".repeat(201) })).summary).toBeTruthy();
    expect(hasErrors(validateDetails(draft({ summary: "" })))).toBe(false);
  });
});

describe("schedule-step validation", () => {
  it("resolves a valid local schedule to unix seconds", () => {
    const result = validateSchedule(draft(), NOW);
    expect(hasErrors(result.errors)).toBe(false);
    expect(result.start).toBe(Math.floor(new Date(2027, 0, 15, 18, 0).getTime() / 1000));
    expect(result.end).toBe(Math.floor(new Date(2027, 0, 15, 20, 0).getTime() / 1000));
  });

  it("rejects malformed and impossible dates", () => {
    expect(validateSchedule(draft({ date: "15/01/2027" }), NOW).errors.date).toBeTruthy();
    expect(validateSchedule(draft({ date: "2027-02-30" }), NOW).errors.date).toBeTruthy();
    expect(validateSchedule(draft({ date: "" }), NOW).errors.date).toBeTruthy();
  });

  it("rejects malformed times", () => {
    expect(validateSchedule(draft({ startTime: "6pm" }), NOW).errors.startTime).toBeTruthy();
    expect(validateSchedule(draft({ endTime: "24:00" }), NOW).errors.endTime).toBeTruthy();
  });

  it("rejects an end that does not come after the start", () => {
    expect(validateSchedule(draft({ startTime: "20:00", endTime: "18:00" }), NOW).errors.endTime).toBeTruthy();
    expect(validateSchedule(draft({ startTime: "18:00", endTime: "18:00" }), NOW).errors.endTime).toBeTruthy();
  });

  it("rejects a start in the past", () => {
    expect(validateSchedule(draft({ date: "2025-12-31" }), NOW).errors.date).toBeTruthy();
  });
});

describe("capacity validation", () => {
  it("accepts empty and positive whole numbers", () => {
    expect(isValidCapacity("")).toBe(true);
    expect(isValidCapacity("  ")).toBe(true);
    expect(isValidCapacity("48")).toBe(true);
  });

  it("rejects zero, negatives, decimals, and non-numeric text", () => {
    expect(isValidCapacity("0")).toBe(false);
    expect(isValidCapacity("-3")).toBe(false);
    expect(isValidCapacity("2.5")).toBe(false);
    expect(isValidCapacity("full house")).toBe(false);
  });
});

describe("draft helpers", () => {
  it("generates unique event identifiers", () => {
    expect(newEventIdentifier()).not.toBe(newEventIdentifier());
    expect(newEventIdentifier()).toMatch(/^event-/);
  });

  it("formats dates and times in 24-hour local time", () => {
    const unix = Math.floor(new Date(2027, 0, 15, 18, 5).getTime() / 1000);
    expect(formatEventDate(unix)).toBe("Fri, 15 Jan 2027");
    expect(formatEventTime(unix)).toBe("18:05");
  });
});
