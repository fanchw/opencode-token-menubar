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

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface TodaySummary {
  requestCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  averageTokensPerSecond: number;
}

export interface ModelRankingRow {
  provider: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  averageTokensPerSecond: number;
}

export interface HourlyTrendRow {
  hour: string;
  totalTokens: number;
  averageTokensPerSecond: number;
}

export interface DashboardFilters {
  start: string;
  end: string;
  providers?: string[];
  models?: string[];
}

export interface FilterOption {
  value: string;
  requestCount: number;
  totalTokens: number;
}

export interface DashboardData {
  today: TodaySummary;
  recent: MetricEvent[];
  modelRanking: ModelRankingRow[];
  hourlyTrends: HourlyTrendRow[];
  providers: FilterOption[];
  models: FilterOption[];
  importErrors?: number;
  pluginInstalled?: boolean;
  paths?: {
    jsonlPath: string;
    ingestPath: string;
    sqlitePath: string;
    pluginPath: string;
  };
}

export interface TokenMetricsApi {
  getDashboardData(filters: DashboardFilters): Promise<DashboardData>;
  installPlugin(): Promise<{ installed: true; targetPath: string }>;
  onDashboardUpdated(callback: () => void): () => void;
}

declare global {
  interface Window {
    tokenMetrics: TokenMetricsApi;
  }
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

export function formatTokenUnit(value: number): string {
  const normalizedValue = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const units = [
    { suffix: "T", divisor: 1_000_000_000_000 },
    { suffix: "B", divisor: 1_000_000_000 },
    { suffix: "M", divisor: 1_000_000 },
    { suffix: "K", divisor: 1_000 },
  ];

  for (const unit of units) {
    if (normalizedValue >= unit.divisor) {
      return `${(normalizedValue / unit.divisor).toFixed(1).replace(/\.0$/, "")}${unit.suffix}`;
    }
  }

  return Math.floor(normalizedValue).toString();
}

function normalizeTimestamp(value: string | null | undefined): string {
  const timestamp = value ? new Date(value) : new Date();

  return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
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
