import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import sqlite from "node-sqlite3-wasm";
import type { BindValues } from "node-sqlite3-wasm";

import type { DashboardData, MetricEvent } from "../shared/metrics.js";

export interface DashboardQuery {
  dayStart: string;
  dayEnd: string;
  recentLimit: number;
}

interface SummaryRow {
  requestCount: number | null;
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
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

  constructor(databasePath: string, DatabaseCtor: DatabaseConstructor = MetricsStore.DatabaseConstructor) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseCtor(databasePath);
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
            "@totalTokens": event.totalTokens,
            "@durationMs": event.durationMs,
            "@tokensPerSecond": event.tokensPerSecond,
          },
        );
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getDashboardData({ dayStart, dayEnd, recentLimit }: DashboardQuery): DashboardData {
    const todaySummary = this.database.get(
      `
        SELECT
          COUNT(*) AS requestCount,
          COALESCE(SUM(tokens), 0) AS totalTokens,
          COALESCE(SUM(inputTokens), 0) AS inputTokens,
          COALESCE(SUM(outputTokens), 0) AS outputTokens,
          COALESCE(AVG(speed), 0) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
      `,
      [dayStart, dayEnd],
    ) as SummaryRow | undefined ?? {
      requestCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      averageTokensPerSecond: 0,
    };

    const recent = this.database.all(
      `
        SELECT id,
          timestamp,
          provider,
          model,
          inputTokens,
          outputTokens,
          tokens AS totalTokens,
          duration AS durationMs,
          speed AS tokensPerSecond
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
        ORDER BY timestamp DESC
        LIMIT ?
      `,
      [dayStart, dayEnd, recentLimit],
    ) as DashboardData["recent"];

    const modelRanking = this.database.all(
      `
        SELECT provider,
          model,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens,
          SUM(inputTokens) AS inputTokens,
          SUM(outputTokens) AS outputTokens,
          AVG(speed) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY provider, model
        ORDER BY totalTokens DESC, requestCount DESC, provider ASC, model ASC
      `,
      [dayStart, dayEnd],
    ) as DashboardData["modelRanking"];

    const hourlyTrends = this.database.all(
      `
        SELECT strftime('%Y-%m-%dT%H:00:00.000Z', timestamp) AS hour,
          SUM(tokens) AS totalTokens,
          AVG(speed) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY hour
        ORDER BY hour ASC
      `,
      [dayStart, dayEnd],
    ) as DashboardData["hourlyTrends"];

    return {
      today: {
        requestCount: todaySummary.requestCount ?? 0,
        totalTokens: todaySummary.totalTokens ?? 0,
        inputTokens: todaySummary.inputTokens ?? 0,
        outputTokens: todaySummary.outputTokens ?? 0,
        averageTokensPerSecond: todaySummary.averageTokensPerSecond ?? 0,
      },
      recent,
      modelRanking,
      hourlyTrends,
    };
  }

  close(): void {
    this.database.close();
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
        tokens INTEGER NOT NULL,
        duration REAL NOT NULL,
        speed REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests (timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_provider_model ON requests (provider, model);
    `);
  }
}
