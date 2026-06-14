import type { DashboardFilters } from "../shared/metrics.js"
import { t } from "./i18n.js"
import { formatTimeInZone } from "./timeFilters.js"
import type { QuickRange, TimezoneMode } from "./timeFilters.js"

export const debounceMs = 120

export const emptyChartData = [
  { hour: "", ts: 0, label: "", totalTokens: 0, averageTokensPerSecond: 0 },
  { hour: "", ts: 0, label: "", totalTokens: 0, averageTokensPerSecond: 0 },
]

export function fillEmptyBuckets(
  trends: Array<{ hour: string; totalTokens: number; inputTokens: number; outputTokens: number; cacheTokens: number; averageTokensPerSecond: number }>,
  intervalSec: number,
  startMs: number,
  endMs: number,
): typeof trends {
  if (trends.length === 0 || intervalSec <= 0) return trends

  const dataMap = new Map(
    trends.map((row) => [
      Math.floor(new Date(row.hour).getTime() / 1000 / intervalSec) * intervalSec,
      row,
    ]),
  )

  const result: typeof trends = []
  const firstBucket = Math.floor(startMs / 1000 / intervalSec) * intervalSec
  const lastBucket = Math.floor(endMs / 1000 / intervalSec) * intervalSec

  for (let epoch = firstBucket; epoch <= lastBucket; epoch += intervalSec) {
    const existing = dataMap.get(epoch)
    if (existing) {
      result.push(existing)
    } else {
      result.push({
        hour: new Date(epoch * 1000).toISOString(),
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        averageTokensPerSecond: 0,
      })
    }
  }

  return result
}

export const quickRanges: Array<{ labelKey: string; value: QuickRange }> = [
  { labelKey: "range.quick.today", value: "today" },
  { labelKey: "range.quick.week", value: "week" },
  { labelKey: "range.quick.month", value: "month" },
  { labelKey: "range.quick.15m", value: "15m" },
  { labelKey: "range.quick.1h", value: "1h" },
  { labelKey: "range.quick.6h", value: "6h" },
  { labelKey: "range.quick.24h", value: "24h" },
  { labelKey: "range.quick.7d", value: "7d" },
  { labelKey: "range.quick.30d", value: "30d" },
]

export function toDateTimeLocalValue(timestamp: string): string {
  const date = new Date(timestamp)
  const offsetMs = date.getTimezoneOffset() * 60 * 1000

  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Number.isFinite(value) ? Math.round(value) : 0)
}

export function formatSpeed(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : "0.0"} tok/s`
}

export function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0ms"
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
}

export function formatRequestTime(timestamp: string, timezone: TimezoneMode): string {
  return formatTimeInZone(timestamp, timezone, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function formatRangeSummary(filters: DashboardFilters, timezone: TimezoneMode, quickRange: QuickRange, customRange: { start: string; end: string } | null): string {
  const rangeMeta = quickRanges.find((range) => range.value === quickRange)
  const preset = rangeMeta ? t(rangeMeta.labelKey) : quickRange
  if (!customRange) return preset

  const start = formatTimeInZone(filters.start, timezone)
  const end = formatTimeInZone(filters.end, timezone)

  return `${start} -> ${end}`
}

export function toggleSelection(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}
