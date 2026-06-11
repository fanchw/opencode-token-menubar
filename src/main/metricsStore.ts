import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

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

export class MetricsStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.initializeSchema();
  }

  insertEvents(events: MetricEvent[]): void {
    const insert = this.database.prepare(`
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
    `);
    const transaction = this.database.transaction((metricEvents: MetricEvent[]) => {
      for (const event of metricEvents) {
        insert.run(event);
      }
    });

    transaction(events);
  }

  getDashboardData({ dayStart, dayEnd, recentLimit }: DashboardQuery): DashboardData {
    const todaySummary = this.database
      .prepare<[string, string], SummaryRow>(`
        SELECT
          COUNT(*) AS requestCount,
          COALESCE(SUM(tokens), 0) AS totalTokens,
          COALESCE(SUM(inputTokens), 0) AS inputTokens,
          COALESCE(SUM(outputTokens), 0) AS outputTokens,
          COALESCE(AVG(speed), 0) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
      `)
      .get(dayStart, dayEnd) ?? {
      requestCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      averageTokensPerSecond: 0,
    };

    const recent = this.database
      .prepare<[string, string, number], DashboardData["recent"][number]>(`
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
      `)
      .all(dayStart, dayEnd, recentLimit);

    const modelRanking = this.database
      .prepare<[string, string], DashboardData["modelRanking"][number]>(`
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
      `)
      .all(dayStart, dayEnd);

    const hourlyTrends = this.database
      .prepare<[string, string], DashboardData["hourlyTrends"][number]>(`
        SELECT strftime('%Y-%m-%dT%H:00:00.000Z', timestamp) AS hour,
          SUM(tokens) AS totalTokens,
          AVG(speed) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY hour
        ORDER BY hour ASC
      `)
      .all(dayStart, dayEnd);

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
