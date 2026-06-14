import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import type { BindValues } from "node-sqlite3-wasm";

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
    cacheTokens: 0,
    totalTokens: 150,
    durationMs: 3000,
    tokensPerSecond: 50,
    firstTokenLatencyMs: null,
  },
  {
    id: "req-2",
    timestamp: "2026-06-11T01:20:00.000Z",
    provider: "openai",
    model: "gpt-4.1",
    inputTokens: 200,
    outputTokens: 100,
    cacheTokens: 0,
    totalTokens: 300,
    durationMs: 6000,
    tokensPerSecond: 50,
    firstTokenLatencyMs: null,
  },
  {
    id: "req-3",
    timestamp: "2026-06-10T23:50:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputTokens: 10,
    outputTokens: 5,
    cacheTokens: 0,
    totalTokens: 15,
    durationMs: 1000,
    tokensPerSecond: 15,
    firstTokenLatencyMs: null,
  },
  {
    id: "req-4",
    timestamp: "2026-06-11T01:45:00.000Z",
    provider: "anthropic",
    model: "claude-haiku-3.5",
    inputTokens: 40,
    outputTokens: 10,
    cacheTokens: 0,
    totalTokens: 50,
    durationMs: 2000,
    tokensPerSecond: 25,
    firstTokenLatencyMs: null,
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

  test("accepts an injected database constructor", () => {
    tempDir = mkdtempSync(join(tmpdir(), "metrics-store-"));
    const createdPaths: string[] = [];
    const DatabaseConstructor = class extends MetricsStore.DatabaseConstructor {
      constructor(databasePath: string) {
        createdPaths.push(databasePath);
        super(databasePath);
      }
    };

    store = new MetricsStore(join(tempDir, "nested", "metrics.sqlite"), DatabaseConstructor);

    expect(createdPaths).toEqual([join(tempDir, "nested", "metrics.sqlite")]);
  });

  test("imports duplicate ids only once", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents([baseEvents[0], baseEvents[0]]);

    const data = metricsStore.getDashboardData({
      start: "2026-06-11T00:00:00.000Z",
      end: "2026-06-12T00:00:00.000Z",
      recentPageSize: 10,
    });

    expect(data.today.requestCount).toBe(1);
    expect(data.today.totalTokens).toBe(150);
  });

  test("returns dashboard data for today summary, recent requests, ranking, and hourly trends", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);

    const data = metricsStore.getDashboardData({
      start: "2026-06-11T00:00:00.000Z",
      end: "2026-06-12T00:00:00.000Z",
      recentPage: 1,
      recentPageSize: 2,
    });

    expect(data.today).toEqual({
      requestCount: 3,
      totalTokens: 500,
      inputTokens: 340,
      outputTokens: 160,
      cacheTokens: 0,
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
        cacheTokens: 0,
        totalTokens: 50,
        durationMs: 2000,
        tokensPerSecond: 25,
        firstTokenLatencyMs: null,
      },
      {
        id: "req-2",
        timestamp: "2026-06-11T01:20:00.000Z",
        provider: "openai",
        model: "gpt-4.1",
        inputTokens: 200,
        outputTokens: 100,
        cacheTokens: 0,
        totalTokens: 300,
        durationMs: 6000,
        tokensPerSecond: 50,
        firstTokenLatencyMs: null,
      },
    ]);
    expect(data.recentTotal).toBe(3);
    expect(data.modelRanking).toEqual([
      {
        provider: "openai",
        model: "gpt-4.1",
        requestCount: 1,
        totalTokens: 300,
        inputTokens: 200,
        outputTokens: 100,
        cacheTokens: 0,
        averageTokensPerSecond: 50,
      },
      {
        provider: "anthropic",
        model: "claude-sonnet-4",
        requestCount: 1,
        totalTokens: 150,
        inputTokens: 100,
        outputTokens: 50,
        cacheTokens: 0,
        averageTokensPerSecond: 50,
      },
      {
        provider: "anthropic",
        model: "claude-haiku-3.5",
        requestCount: 1,
        totalTokens: 50,
        inputTokens: 40,
        outputTokens: 10,
        cacheTokens: 0,
        averageTokensPerSecond: 25,
      },
    ]);
    expect(data.hourlyTrends).toEqual([
      { hour: "2026-06-11T00:00:00.000Z", totalTokens: 150, inputTokens: 100, outputTokens: 50, cacheTokens: 0, averageTokensPerSecond: 50 },
      { hour: "2026-06-11T01:00:00.000Z", totalTokens: 350, inputTokens: 240, outputTokens: 110, cacheTokens: 0, averageTokensPerSecond: 37.5 },
    ]);
  });

  test("filters dashboard data by time provider and model", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);

    const data = metricsStore.getDashboardData({
      start: "2026-06-11T00:00:00.000Z",
      end: "2026-06-11T02:00:00.000Z",
      providers: ["anthropic"],
      models: ["claude-haiku-3.5"],
      recentPageSize: 10,
    });

    expect(data.today).toEqual({
      requestCount: 1,
      totalTokens: 50,
      inputTokens: 40,
      outputTokens: 10,
      cacheTokens: 0,
      averageTokensPerSecond: 25,
    });
    expect(data.recent.map((event) => event.id)).toEqual(["req-4"]);
    expect(data.modelRanking).toEqual([
      {
        provider: "anthropic",
        model: "claude-haiku-3.5",
        requestCount: 1,
        totalTokens: 50,
        inputTokens: 40,
        outputTokens: 10,
        cacheTokens: 0,
        averageTokensPerSecond: 25,
      },
    ]);
    expect(data.hourlyTrends).toEqual([
      { hour: "2026-06-11T01:45:00.000Z", totalTokens: 50, inputTokens: 40, outputTokens: 10, cacheTokens: 0, averageTokensPerSecond: 25 },
    ]);
  });

  test("returns provider and model filter options for selected time range", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);

    const data = metricsStore.getDashboardData({
      start: "2026-06-11T00:00:00.000Z",
      end: "2026-06-12T00:00:00.000Z",
      providers: ["anthropic"],
      models: ["claude-haiku-3.5"],
      recentPageSize: 10,
    });

    expect(data.providers).toEqual([
      { value: "openai", requestCount: 1, totalTokens: 300 },
      { value: "anthropic", requestCount: 2, totalTokens: 200 },
    ]);
    expect(data.models).toEqual([
      { value: "claude-sonnet-4", requestCount: 1, totalTokens: 150 },
      { value: "claude-haiku-3.5", requestCount: 1, totalTokens: 50 },
    ]);
  });

  test("getTraySummary returns null speed and zero tokens for empty store", () => {
    const metricsStore = createStore();
    const summary = metricsStore.getTraySummary(
      "2026-06-11T00:00:00.000Z",
      "2026-06-12T00:00:00.000Z",
    );
    expect(summary).toEqual({ latestSpeed: null, totalTokens: 0 });
  });

  test("getTraySummary returns latest speed and total tokens within range", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);
    const summary = metricsStore.getTraySummary(
      "2026-06-11T00:00:00.000Z",
      "2026-06-12T00:00:00.000Z",
    );
    expect(summary).toEqual({ latestSpeed: 25, totalTokens: 500 });
  });

  test("getTraySummary returns null speed when no data in range", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);
    const summary = metricsStore.getTraySummary(
      "2026-06-12T00:00:00.000Z",
      "2026-06-13T00:00:00.000Z",
    );
    expect(summary).toEqual({ latestSpeed: null, totalTokens: 0 });
  });

  test("caches catalog queries until invalidated by write", () => {
    tempDir = mkdtempSync(join(tmpdir(), "metrics-store-"));
    const dbPath = join(tempDir, "metrics.sqlite");

    // 用计数包装代理统计 SELECT 查询次数
    const counts = { all: 0 };
    class CountingDatabase extends MetricsStore.DatabaseConstructor {
      override all(sql: string, values?: BindValues): unknown[] {
        counts.all += 1;
        return super.all(sql, values);
      }
    }

    const countingStore = new MetricsStore(dbPath, CountingDatabase);
    countingStore.insertEvents([baseEvents[0]]);
    counts.all = 0;

    // 首次：3 个 catalog getter 各查一次
    countingStore.getCatalogProviders();
    countingStore.getCatalogModels();
    countingStore.getModelProviderMap();
    expect(counts.all).toBe(3);

    // 第二次：全命中缓存，零查询
    countingStore.getCatalogProviders();
    countingStore.getCatalogModels();
    countingStore.getModelProviderMap();
    expect(counts.all).toBe(3);

    // 写入后失效：再次查询重跑
    countingStore.insertEvents([baseEvents[1]]);
    counts.all = 0;
    countingStore.getCatalogProviders();
    expect(counts.all).toBe(1);

    countingStore.close();
  });
});
