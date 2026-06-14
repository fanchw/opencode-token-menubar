import { afterEach, describe, expect, test, vi } from "vitest";

import { EventBuffer } from "./eventBuffer.js";
import type { MetricEvent } from "../shared/metrics.js";

const testEvent: MetricEvent = {
  id: "evt-1",
  timestamp: "2026-06-14T10:00:00.000Z",
  provider: "anthropic",
  model: "claude-sonnet-4",
  inputTokens: 100,
  outputTokens: 50,
  cacheTokens: 0,
  totalTokens: 150,
  durationMs: 3000,
  tokensPerSecond: 50,
  firstTokenLatencyMs: null,
};

describe("EventBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("does not flush immediately on push", () => {
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);

    expect(onFlush).not.toHaveBeenCalled();
    expect(buffer.size).toBe(1);
  });

  test("flushes after flushMs", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([testEvent]);
    expect(buffer.size).toBe(0);
  });

  test("coalesces multiple pushes into single flush", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    const e1 = { ...testEvent, id: "e1" };
    const e2 = { ...testEvent, id: "e2" };
    const e3 = { ...testEvent, id: "e3" };
    buffer.push(e1);
    buffer.push(e2);
    buffer.push(e3);
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([e1, e2, e3]);
  });

  test("manual flush clears pending timer", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);
    buffer.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  test("flush with empty buffer does not call onFlush", () => {
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.flush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  test("push after flush starts a new timer", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);
    vi.advanceTimersByTime(200);

    const e2 = { ...testEvent, id: "e2" };
    buffer.push(e2);
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(2, [e2]);
  });
});
