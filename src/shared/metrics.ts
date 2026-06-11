export interface RawMetricEvent {
  id?: string | null;
  timestamp?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  tokensPerSecond?: number | null;
}

type NumericValue = number | null | undefined;

export interface MetricEvent {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  tokensPerSecond: number;
}

export interface TodaySummary {
  requestCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  averageTokensPerSecond: number;
}

export interface RecentRequest {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  totalTokens: number;
  durationMs: number;
}

export interface ModelRankingRow {
  provider: string;
  model: string;
  requestCount: number;
  totalTokens: number;
}

export interface HourlyTrendRow {
  hour: string;
  requestCount: number;
  totalTokens: number;
}

export interface DashboardData {
  todaySummary: TodaySummary;
  recentRequests: RecentRequest[];
  modelRanking: ModelRankingRow[];
  hourlyTrend: HourlyTrendRow[];
}

function normalizeTokenCount(value: NumericValue): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeDuration(value: NumericValue): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeRate(value: NumericValue): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeTimestamp(value: string | null | undefined): string {
  return value && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
}

export function normalizeMetricEvent(raw: RawMetricEvent): MetricEvent | null {
  if (!raw.id) {
    return null;
  }

  const inputTokens = normalizeTokenCount(raw.inputTokens);
  const outputTokens = normalizeTokenCount(raw.outputTokens);
  const derivedTotalTokens = inputTokens + outputTokens;
  const normalizedTotalTokens = normalizeTokenCount(raw.totalTokens);
  const totalTokens =
    normalizedTotalTokens >= derivedTotalTokens ? normalizedTotalTokens : derivedTotalTokens;
  const durationMs = normalizeDuration(raw.durationMs);
  const normalizedTokensPerSecond = normalizeRate(raw.tokensPerSecond);
  const tokensPerSecond =
    normalizedTokensPerSecond ?? (durationMs > 0 ? totalTokens / (durationMs / 1000) : 0);

  return {
    id: raw.id,
    timestamp: normalizeTimestamp(raw.timestamp),
    provider: raw.provider ?? "unknown",
    model: raw.model ?? "unknown",
    inputTokens,
    outputTokens,
    totalTokens,
    durationMs,
    tokensPerSecond,
  };
}
