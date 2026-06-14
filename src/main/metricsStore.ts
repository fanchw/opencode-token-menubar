import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import sqlite from "node-sqlite3-wasm";
import type { BindValues } from "node-sqlite3-wasm";

import type { DashboardData, DashboardFilters, FilterOption, MetricEvent } from "../shared/metrics.js";

export interface DashboardQuery extends DashboardFilters {
  recentPage?: number;
  recentPageSize?: number;
}

export interface TraySummary {
  latestSpeed: number | null;
  totalTokens: number;
}

interface TrendBucket {
  bucketEpoch: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  averageTokensPerSecond: number;
}

export function chooseTrendInterval(startMs: number, endMs: number): number {
  const spanMin = (endMs - startMs) / 60000;
  if (spanMin <= 60) return 60;
  if (spanMin <= 360) return 300;
  if (spanMin <= 1440) return 3600;
  if (spanMin <= 10080) return 21600;
  return 86400;
}

const VALID_TREND_INTERVALS = new Set([60, 300, 3600, 21600, 86400]);

function assertValidTrendInterval(seconds: number): void {
  if (!VALID_TREND_INTERVALS.has(seconds)) {
    throw new Error(`Invalid trend interval: ${seconds}`);
  }
}

interface SummaryRow {
  requestCount: number | null;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheTokens: number | null;
  averageTokensPerSecond: number | null;
}

interface DatabaseConnection {
  all(sql: string, values?: BindValues): unknown[];
  close(): void;
  exec(sql: string): void;
  get(sql: string, values?: BindValues): unknown;
  run(sql: string, values?: BindValues): unknown;
}

type DatabaseConstructor = new (databasePath: string) => DatabaseConnection;

export class MetricsStore {
  static readonly DatabaseConstructor: DatabaseConstructor = sqlite.Database;

  private readonly database: DatabaseConnection;
  private catalogCache: {
    providers: string[] | null;
    models: string[] | null;
    modelProviderMap: Record<string, string[]> | null;
  } = { providers: null, models: null, modelProviderMap: null };

  constructor(databasePath: string, DatabaseCtor: DatabaseConstructor = MetricsStore.DatabaseConstructor) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseCtor(databasePath);
    this.database.exec("PRAGMA busy_timeout=5000");
    this.initializeSchema();
  }

  insertEvents(events: MetricEvent[]): void {
    this.database.exec("BEGIN TRANSACTION");
    try {
      for (const event of events) {
        this.database.run(
          `
            INSERT OR IGNORE INTO requests (
              id,
              timestamp,
              provider,
              model,
              inputTokens,
              outputTokens,
              cacheTokens,
              firstTokenLatencyMs,
              tokens,
              duration,
              speed
            ) VALUES (
              @id,
              @timestamp,
              @provider,
              @model,
              @inputTokens,
              @outputTokens,
              @cacheTokens,
              @firstTokenLatencyMs,
              @totalTokens,
              @durationMs,
              @tokensPerSecond
            )
          `,
          {
            "@id": event.id,
            "@timestamp": event.timestamp,
            "@provider": event.provider,
            "@model": event.model,
            "@inputTokens": event.inputTokens,
            "@outputTokens": event.outputTokens,
            "@cacheTokens": event.cacheTokens,
            "@firstTokenLatencyMs": event.firstTokenLatencyMs,
            "@totalTokens": event.totalTokens,
            "@durationMs": event.durationMs,
            "@tokensPerSecond": event.tokensPerSecond,
          },
        );
        this.upsertCatalog(event.provider, event.model);
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  syncCatalog(entries: Array<{ provider: string; model: string }>): void {
    this.database.exec("BEGIN TRANSACTION");
    try {
      for (const entry of entries) {
        this.upsertCatalog(entry.provider, entry.model);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getCatalogProviders(): string[] {
    if (this.catalogCache.providers !== null) return this.catalogCache.providers;
    const rows = this.database.all(
      "SELECT value FROM providers ORDER BY value",
    ) as { value: string }[];
    const providers = rows.map((row) => row.value);
    this.catalogCache.providers = providers;
    return providers;
  }

  getCatalogModels(): string[] {
    if (this.catalogCache.models !== null) return this.catalogCache.models;
    const rows = this.database.all(
      "SELECT DISTINCT value FROM models ORDER BY value",
    ) as { value: string }[];
    const models = rows.map((row) => row.value);
    this.catalogCache.models = models;
    return models;
  }

  getModelProviders(model: string): string[] {
    const rows = this.database.all(
      "SELECT provider FROM models WHERE value = ? ORDER BY provider",
      [model],
    ) as { provider: string }[];
    return rows.map((row) => row.provider);
  }

  getModelProviderMap(): Record<string, string[]> {
    if (this.catalogCache.modelProviderMap !== null) return this.catalogCache.modelProviderMap;
    const rows = this.database.all(
      "SELECT value, provider FROM models ORDER BY value, provider",
    ) as { value: string; provider: string }[];
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      if (!map[row.value]) map[row.value] = [];
      map[row.value].push(row.provider);
    }
    this.catalogCache.modelProviderMap = map;
    return map;
  }

  getModelsForProviders(providerList: string[]): string[] {
    if (providerList.length === 0) return this.getCatalogModels();
    const placeholders = providerList.map(() => "?").join(", ");
    const rows = this.database.all(
      `SELECT DISTINCT value FROM models WHERE provider IN (${placeholders}) ORDER BY value`,
      providerList,
    ) as { value: string }[];
    return rows.map((row) => row.value);
  }

  getTrends({ start, end, providers, models }: DashboardQuery): {
    trends: import("../shared/metrics.js").HourlyTrendRow[];
    trendIntervalSeconds: number;
  } {
    const filters = this.buildFilterClause(start, end, providers, models);
    const trendIntervalSeconds = chooseTrendInterval(
      new Date(start).getTime(),
      new Date(end).getTime(),
    );
    assertValidTrendInterval(trendIntervalSeconds);

    const trendBuckets = this.database.all(
      `
        SELECT
          (CAST(strftime('%s', timestamp) AS INTEGER) / ${trendIntervalSeconds}) * ${trendIntervalSeconds} AS bucketEpoch,
          SUM(tokens) AS totalTokens,
          SUM(inputTokens) AS inputTokens,
          SUM(outputTokens) AS outputTokens,
          SUM(cacheTokens) AS cacheTokens,
          AVG(speed) AS averageTokensPerSecond
        FROM requests
        ${filters.whereClause}
        GROUP BY bucketEpoch
        ORDER BY bucketEpoch ASC
      `,
      filters.values,
    ) as TrendBucket[];

    const trends = trendBuckets.map((bucket) => ({
      hour: new Date(bucket.bucketEpoch * 1000).toISOString(),
      totalTokens: bucket.totalTokens,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      cacheTokens: bucket.cacheTokens,
      averageTokensPerSecond: bucket.averageTokensPerSecond,
    }));

    return { trends, trendIntervalSeconds };
  }

  getSummary({ start, end, providers, models }: DashboardQuery): import("../shared/metrics.js").TodaySummary {
    const filters = this.buildFilterClause(start, end, providers, models);
    const row = this.database.get(
      `
        SELECT
          COUNT(*) AS requestCount,
          COALESCE(SUM(tokens), 0) AS totalTokens,
          COALESCE(SUM(inputTokens), 0) AS inputTokens,
          COALESCE(SUM(outputTokens), 0) AS outputTokens,
          COALESCE(SUM(cacheTokens), 0) AS cacheTokens,
          COALESCE(AVG(speed), 0) AS averageTokensPerSecond
        FROM requests
        ${filters.whereClause}
      `,
      filters.values,
    ) as SummaryRow | undefined;

    return {
      requestCount: row?.requestCount ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      cacheTokens: row?.cacheTokens ?? 0,
      averageTokensPerSecond: row?.averageTokensPerSecond ?? 0,
    };
  }

  getRecent({ start, end, providers, models, recentPage, recentPageSize }: DashboardQuery): {
    rows: import("../shared/metrics.js").MetricEvent[];
    total: number;
  } {
    const filters = this.buildFilterClause(start, end, providers, models);
    const page = typeof recentPage === "number" && recentPage >= 1 ? Math.floor(recentPage) : 1;
    const pageSize =
      typeof recentPageSize === "number" && recentPageSize >= 1 ? Math.floor(recentPageSize) : 50;
    const offset = (page - 1) * pageSize;

    const rows = this.database.all(
      `
        SELECT id,
          timestamp,
          provider,
          model,
          inputTokens,
          outputTokens,
          cacheTokens,
          firstTokenLatencyMs,
          tokens AS totalTokens,
          duration AS durationMs,
          speed AS tokensPerSecond
        FROM requests
        ${filters.whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `,
      [...filters.values, pageSize, offset],
    ) as import("../shared/metrics.js").MetricEvent[];

    const countRow = this.database.get(
      `SELECT COUNT(*) AS count FROM requests ${filters.whereClause}`,
      filters.values,
    ) as { count: number } | undefined;

    return { rows, total: countRow?.count ?? 0 };
  }

  getRanking({ start, end, providers, models }: DashboardQuery): import("../shared/metrics.js").ModelRankingRow[] {
    const filters = this.buildFilterClause(start, end, providers, models);
    return this.database.all(
      `
        SELECT provider,
          model,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens,
          SUM(inputTokens) AS inputTokens,
          SUM(outputTokens) AS outputTokens,
          SUM(cacheTokens) AS cacheTokens,
          AVG(speed) AS averageTokensPerSecond
        FROM requests
        ${filters.whereClause}
        GROUP BY provider, model
        ORDER BY totalTokens DESC, requestCount DESC, provider ASC, model ASC
      `,
      filters.values,
    ) as import("../shared/metrics.js").ModelRankingRow[];
  }

  getFilterOptions({ start, end, providers }: DashboardQuery): {
    providers: import("../shared/metrics.js").FilterOption[];
    models: import("../shared/metrics.js").FilterOption[];
  } {
    const providerFilters = this.buildFilterClause(start, end);
    const modelFilters = this.buildFilterClause(start, end, providers);

    const providerOptions = this.database.all(
      `
        SELECT provider AS value,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens
        FROM requests
        ${providerFilters.whereClause}
        GROUP BY provider
        ORDER BY totalTokens DESC, requestCount DESC, value ASC
      `,
      providerFilters.values,
    ) as import("../shared/metrics.js").FilterOption[];

    const modelOptions = this.database.all(
      `
        SELECT model AS value,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens
        FROM requests
        ${modelFilters.whereClause}
        GROUP BY model
        ORDER BY totalTokens DESC, requestCount DESC, value ASC
      `,
      modelFilters.values,
    ) as import("../shared/metrics.js").FilterOption[];

    return { providers: providerOptions, models: modelOptions };
  }

  getDashboardData(query: DashboardQuery): DashboardData {
    const summary = this.getSummary(query);
    const recent = this.getRecent(query);
    const modelRanking = this.getRanking(query);
    const { trends: hourlyTrends, trendIntervalSeconds } = this.getTrends(query);
    const { providers, models } = this.getFilterOptions(query);

    return {
      today: summary,
      recent: recent.rows,
      recentTotal: recent.total,
      modelRanking,
      hourlyTrends,
      trendIntervalSeconds,
      providers,
      models,
    };
  }

  close(): void {
    this.database.close();
    this.catalogCache = { providers: null, models: null, modelProviderMap: null };
  }

  getTraySummary(start: string, end: string): TraySummary {
    const latest = this.database.get(
      `
        SELECT speed FROM requests
        WHERE timestamp >= ? AND timestamp < ?
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      [start, end],
    ) as { speed: number | null } | undefined;

    const summary = this.database.get(
      `
        SELECT COALESCE(SUM(tokens), 0) AS totalTokens
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
      `,
      [start, end],
    ) as { totalTokens: number | null } | undefined;

    return {
      latestSpeed: latest?.speed ?? null,
      totalTokens: summary?.totalTokens ?? 0,
    };
  }

  private upsertCatalog(provider: string, model: string): void {
    this.catalogCache = { providers: null, models: null, modelProviderMap: null };
    const now = new Date().toISOString();
    this.database.run(
      "INSERT OR IGNORE INTO providers (value, first_seen) VALUES (?, ?)",
      [provider, now],
    );
    this.database.run(
      "INSERT OR IGNORE INTO models (value, provider, first_seen) VALUES (?, ?, ?)",
      [model, provider, now],
    );
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        inputTokens INTEGER NOT NULL,
        outputTokens INTEGER NOT NULL,
        cacheTokens INTEGER NOT NULL DEFAULT 0,
        firstTokenLatencyMs INTEGER,
        tokens INTEGER NOT NULL,
        duration REAL NOT NULL,
        speed REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests (timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_provider_model ON requests (provider, model);

      CREATE TABLE IF NOT EXISTS providers (
        value TEXT PRIMARY KEY,
        first_seen TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS models (
        value TEXT NOT NULL,
        provider TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        PRIMARY KEY (value, provider)
      );
    `);

    try {
      this.database.exec("ALTER TABLE requests ADD COLUMN cacheTokens INTEGER NOT NULL DEFAULT 0");
    } catch {
      // cacheTokens 列已存在
    }

    try {
      this.database.exec("ALTER TABLE requests ADD COLUMN firstTokenLatencyMs INTEGER");
    } catch {
      // firstTokenLatencyMs 列已存在
    }
  }

  private buildFilterClause(
    start: string,
    end: string,
    providers?: string[],
    models?: string[],
  ): { whereClause: string; values: Array<string | number> } {
    const clauses = ["timestamp >= ?", "timestamp < ?"];
    const values: Array<string | number> = [start, end];

    if (providers?.length) {
      clauses.push(`provider IN (${providers.map(() => "?").join(", ")})`);
      values.push(...providers);
    }

    if (models?.length) {
      clauses.push(`model IN (${models.map(() => "?").join(", ")})`);
      values.push(...models);
    }

    return { whereClause: `WHERE ${clauses.join(" AND ")}`, values };
  }
}
