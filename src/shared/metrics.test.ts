import { afterEach, describe, expect, test, vi } from "vitest";

import { normalizeMetricEvent } from "./metrics.js";

describe("normalizeMetricEvent", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("normalizes a complete metric event", () => {
    const event = normalizeMetricEvent({
      id: "req-1",
      timestamp: "2026-06-11T10:00:00.000Z",
      provider: "anthropic",
      model: "claude-sonnet-4",
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      durationMs: 5000,
      tokensPerSecond: 40,
    });

    expect(event).toEqual({
      id: "req-1",
      timestamp: "2026-06-11T10:00:00.000Z",
      provider: "anthropic",
      model: "claude-sonnet-4",
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      durationMs: 5000,
      tokensPerSecond: 40,
    });
  });

  test("uses default values for missing fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));

    const event = normalizeMetricEvent({ id: "req-2" });

    expect(event).toEqual({
      id: "req-2",
      timestamp: "2026-06-11T12:00:00.000Z",
      provider: "unknown",
      model: "unknown",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      tokensPerSecond: 0,
    });
  });

  test("derives total tokens and tokens per second", () => {
    const event = normalizeMetricEvent({
      id: "req-3",
      inputTokens: 150,
      outputTokens: 50,
      durationMs: 4000,
    });

    expect(event?.totalTokens).toBe(200);
    expect(event?.tokensPerSecond).toBe(50);
  });

  test("returns null when id is missing", () => {
    expect(normalizeMetricEvent({ provider: "openai" })).toBeNull();
  });

  test("normalizes invalid numeric values to zero and floors token counts", () => {
    const event = normalizeMetricEvent({
      id: "req-4",
      inputTokens: 12.9,
      outputTokens: Number.NaN,
      totalTokens: Number.POSITIVE_INFINITY,
      durationMs: -100,
      tokensPerSecond: Number.NEGATIVE_INFINITY,
    });

    expect(event?.inputTokens).toBe(12);
    expect(event?.outputTokens).toBe(0);
    expect(event?.totalTokens).toBe(12);
    expect(event?.durationMs).toBe(0);
    expect(event?.tokensPerSecond).toBe(0);
  });

  test("derives total tokens when provided total is less than parts", () => {
    const event = normalizeMetricEvent({
      id: "req-5",
      inputTokens: 30,
      outputTokens: 20,
      totalTokens: 40,
    });

    expect(event?.totalTokens).toBe(50);
  });

  test("uses current ISO timestamp when timestamp is invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T13:00:00.000Z"));

    const event = normalizeMetricEvent({ id: "req-6", timestamp: "not-a-date" });

    expect(event?.timestamp).toBe("2026-06-11T13:00:00.000Z");
  });
});
