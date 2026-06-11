import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { MetricsStore } from "./metricsStore.js";
import type { MetricEvent } from "../shared/metrics.js";

const baseEvents: MetricEvent[] = [
  {
    id: "req-1",
    timestamp: "2026-06-11T00:15:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    durationMs: 3000,
    tokensPerSecond: 50,
  },
  {
    id: "req-2",
    timestamp: "2026-06-11T01:20:00.000Z",
    provider: "openai",
    model: "gpt-4.1",
    inputTokens: 200,
    outputTokens: 100,
    totalTokens: 300,
    durationMs: 6000,
    tokensPerSecond: 50,
  },
  {
    id: "req-3",
    timestamp: "2026-06-10T23:50:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    durationMs: 1000,
    tokensPerSecond: 15,
  },
  {
    id: "req-4",
    timestamp: "2026-06-11T01:45:00.000Z",
    provider: "anthropic",
    model: "claude-haiku-3.5",
    inputTokens: 40,
    outputTokens: 10,
    totalTokens: 50,
    durationMs: 2000,
    tokensPerSecond: 25,
  },
];

describe("MetricsStore", () => {
  let tempDir: string | undefined;
  let store: MetricsStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function createStore(): MetricsStore {
    tempDir = mkdtempSync(join(tmpdir(), "metrics-store-"));
    store = new MetricsStore(join(tempDir, "nested", "metrics.sqlite"));
    return store;
  }

  test("imports duplicate ids only once", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents([baseEvents[0], baseEvents[0]]);

    const data = metricsStore.getDashboardData({
      dayStart: "2026-06-11T00:00:00.000Z",
      dayEnd: "2026-06-12T00:00:00.000Z",
      recentLimit: 10,
    });

    expect(data.today.requestCount).toBe(1);
    expect(data.today.totalTokens).toBe(150);
  });

  test("returns dashboard data for today summary, recent requests, ranking, and hourly trends", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);

    const data = metricsStore.getDashboardData({
      dayStart: "2026-06-11T00:00:00.000Z",
      dayEnd: "2026-06-12T00:00:00.000Z",
      recentLimit: 2,
    });

    expect(data.today).toEqual({
      requestCount: 3,
      totalTokens: 500,
      inputTokens: 340,
      outputTokens: 160,
      averageTokensPerSecond: 41.666666666666664,
    });
    expect(data.recent).toEqual([
      {
        id: "req-4",
        timestamp: "2026-06-11T01:45:00.000Z",
        provider: "anthropic",
        model: "claude-haiku-3.5",
        inputTokens: 40,
        outputTokens: 10,
        totalTokens: 50,
        durationMs: 2000,
        tokensPerSecond: 25,
      },
      {
        id: "req-2",
        timestamp: "2026-06-11T01:20:00.000Z",
        provider: "openai",
        model: "gpt-4.1",
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        durationMs: 6000,
        tokensPerSecond: 50,
      },
    ]);
    expect(data.modelRanking).toEqual([
      {
        provider: "openai",
        model: "gpt-4.1",
        requestCount: 1,
        totalTokens: 300,
        inputTokens: 200,
        outputTokens: 100,
        averageTokensPerSecond: 50,
      },
      {
        provider: "anthropic",
        model: "claude-sonnet-4",
        requestCount: 1,
        totalTokens: 150,
        inputTokens: 100,
        outputTokens: 50,
        averageTokensPerSecond: 50,
      },
      {
        provider: "anthropic",
        model: "claude-haiku-3.5",
        requestCount: 1,
        totalTokens: 50,
        inputTokens: 40,
        outputTokens: 10,
        averageTokensPerSecond: 25,
      },
    ]);
    expect(data.hourlyTrends).toEqual([
      { hour: "2026-06-11T00:00:00.000Z", totalTokens: 150, averageTokensPerSecond: 50 },
      { hour: "2026-06-11T01:00:00.000Z", totalTokens: 350, averageTokensPerSecond: 37.5 },
    ]);
  });
});
