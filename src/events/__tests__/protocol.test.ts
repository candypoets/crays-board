/// <reference types="jest" />

import { buildCalendarEvent, calendarEventAddress, KIND_CALENDAR_EVENT } from "@/events/protocol";

const START = 1_800_000_000;
const END = START + 7200;

describe("calendar event builder (kind 31923)", () => {
  it("builds the exact open/free tag set: d, title, start, end, summary", () => {
    const template = buildCalendarEvent({
      identifier: "event-abc",
      title: "  QA Event  ",
      summary: "  A QA gathering.  ",
      start: START,
      end: END,
    });
    expect(template.kind).toBe(KIND_CALENDAR_EVENT);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["d", "event-abc"],
      ["title", "QA Event"],
      ["start", String(START)],
      ["end", String(END)],
      ["summary", "A QA gathering."],
    ]);
  });

  it("rejects an empty identifier", () => {
    expect(() => buildCalendarEvent({ identifier: " ", title: "QA Event", summary: "", start: START, end: END })).toThrow(
      /identifier/,
    );
  });

  it("rejects a missing or oversized title", () => {
    expect(() => buildCalendarEvent({ identifier: "d", title: "x", summary: "", start: START, end: END })).toThrow(
      /title/,
    );
    expect(() =>
      buildCalendarEvent({ identifier: "d", title: "x".repeat(121), summary: "", start: START, end: END }),
    ).toThrow(/title/);
  });

  it("rejects an oversized summary", () => {
    expect(() =>
      buildCalendarEvent({ identifier: "d", title: "QA Event", summary: "x".repeat(201), start: START, end: END }),
    ).toThrow(/summary/);
  });

  it("rejects impossible schedules", () => {
    expect(() => buildCalendarEvent({ identifier: "d", title: "QA Event", summary: "", start: END, end: START })).toThrow(
      /end after/,
    );
    expect(() => buildCalendarEvent({ identifier: "d", title: "QA Event", summary: "", start: 0, end: END })).toThrow(
      /timestamp/,
    );
    expect(() =>
      buildCalendarEvent({ identifier: "d", title: "QA Event", summary: "", start: START, end: Number.MAX_SAFE_INTEGER + 5 }),
    ).toThrow(/timestamp/);
  });

  it("derives the addressable coordinate", () => {
    expect(calendarEventAddress("ab".repeat(32), "event-abc")).toBe(`31923:${"ab".repeat(32)}:event-abc`);
  });
});
