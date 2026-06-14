import { describe, expect, test } from "vitest";

import {
  formatTimeInZone,
  resolveQuickRange,
  validateCustomRange,
} from "./timeFilters.js";

describe("timeFilters", () => {
  test("resolves local today from start of day to next local day boundary", () => {
    const now = new Date(2026, 5, 12, 8, 30, 0, 0);

    const range = resolveQuickRange("today", now, "local");

    const start = new Date(range.start);
    const end = new Date(range.end);
    const expectedEnd = new Date(start);
    expectedEnd.setDate(start.getDate() + 1);
    expect(start).toEqual(new Date(2026, 5, 12, 0, 0, 0, 0));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
    expect(end.getSeconds()).toBe(0);
    expect(end.getMilliseconds()).toBe(0);
    expect(range.end).toBe(expectedEnd.toISOString());
  });

  test("resolves local week using calendar next Monday boundary", () => {
    const now = new Date(2026, 5, 12, 8, 30, 0, 0);
    const expectedStart = new Date(2026, 5, 8, 0, 0, 0, 0);
    const expectedEnd = new Date(expectedStart);
    expectedEnd.setDate(expectedStart.getDate() + 7);

    const range = resolveQuickRange("week", now, "local");

    const start = new Date(range.start);
    const end = new Date(range.end);
    expect(start).toEqual(expectedStart);
    expect(end).toEqual(expectedEnd);
    expect(start.getDay()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
    expect(end.getSeconds()).toBe(0);
    expect(end.getMilliseconds()).toBe(0);
    expect(range.end).toBe(expectedEnd.toISOString());
  });

  test("resolves utc 1h relative range from now", () => {
    const now = new Date("2026-06-12T08:30:00.000Z");

    const range = resolveQuickRange("1h", now, "utc");

    expect(range).toEqual({
      start: "2026-06-12T07:30:00.000Z",
      end: "2026-06-12T08:30:00.000Z",
    });
  });

  test("resolves utc week from Monday boundary", () => {
    const now = new Date("2026-06-12T08:30:00.000Z");

    const range = resolveQuickRange("week", now, "utc");

    expect(range).toEqual({
      start: "2026-06-08T00:00:00.000Z",
      end: "2026-06-15T00:00:00.000Z",
    });
  });

  test("resolves utc month from calendar boundary", () => {
    const now = new Date("2026-06-12T08:30:00.000Z");

    const range = resolveQuickRange("month", now, "utc");

    expect(range).toEqual({
      start: "2026-06-01T00:00:00.000Z",
      end: "2026-07-01T00:00:00.000Z",
    });
  });

  test("rejects custom range when end is not after start", () => {
    const result = validateCustomRange("2026-06-12T08:30", "2026-06-12T08:30");

    expect(result).toEqual({
      valid: false,
      message: "End time must be after start time.",
    });
  });

  test("accepts datetime-local custom range as local input and returns ISO values", () => {
    const result = validateCustomRange("2026-06-12T08:30", "2026-06-12T09:30");

    expect(result).toEqual({
      valid: true,
      start: new Date("2026-06-12T08:30").toISOString(),
      end: new Date("2026-06-12T09:30").toISOString(),
    });
  });

  test("formats UTC time label", () => {
    const label = formatTimeInZone("2026-06-12T08:30:00.000Z", "utc");

    expect(label).toBe("2026-06-12 08:30:00");
  });
});
