import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DayPicker } from "react-day-picker"
import type { DateRange } from "react-day-picker"
import "react-day-picker/style.css"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { DashboardData, DashboardFilters, FilterOption } from "../shared/metrics.js"
import { formatTokenUnit } from "../shared/metrics.js"
import { formatTimeInZone, resolveQuickRange, validateCustomRange } from "./timeFilters.js"
import type { QuickRange, TimezoneMode } from "./timeFilters.js"
import { t, getLocale, setLocale, type Locale } from "./i18n.js"

const debounceMs = 120
const emptyChartData = [
  { hour: "", ts: 0, label: "", totalTokens: 0, averageTokensPerSecond: 0 },
  { hour: "", ts: 0, label: "", totalTokens: 0, averageTokensPerSecond: 0 },
]

function fillEmptyBuckets(
  trends: Array<{ hour: string; totalTokens: number; inputTokens: number; outputTokens: number; cacheTokens: number; averageTokensPerSecond: number }>,
  intervalSec: number,
  startMs: number,
  endMs: number,
): typeof trends {
  if (trends.length === 0 || intervalSec <= 0) return trends

  const dataMap = new Map(
    trends.map((t) => [
      Math.floor(new Date(t.hour).getTime() / 1000 / intervalSec) * intervalSec,
      t,
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

const quickRanges: Array<{ labelKey: string; value: QuickRange }> = [
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

function toDateTimeLocalValue(timestamp: string): string {
  const date = new Date(timestamp)
  const offsetMs = date.getTimezoneOffset() * 60 * 1000

  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Number.isFinite(value) ? Math.round(value) : 0)
}

function formatSpeed(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : "0.0"} tok/s`
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0ms"
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
}

function formatRequestTime(timestamp: string, timezone: TimezoneMode): string {
  return formatTimeInZone(timestamp, timezone, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function formatRangeSummary(filters: DashboardFilters, timezone: TimezoneMode, quickRange: QuickRange, customRange: { start: string; end: string } | null): string {
  const rangeMeta = quickRanges.find((range) => range.value === quickRange)
  const preset = rangeMeta ? t(rangeMeta.labelKey) : quickRange
  if (!customRange) return preset

  const start = formatTimeInZone(filters.start, timezone)
  const end = formatTimeInZone(filters.end, timezone)

  return `${start} -> ${end}`
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [quickRange, setQuickRange] = useState<QuickRange>("today")
  const [timezone, setTimezone] = useState<TimezoneMode>("local")
  const [activeFilterTab, setActiveFilterTab] = useState<"range" | "providers" | "models" | null>(null)
  const [hoveredModel, setHoveredModel] = useState<{ x: number; y: number; text: string } | null>(null)
  const [cellTip, setCellTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null)
  const [customRangeError, setCustomRangeError] = useState<string | null>(null)
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [providerSearch, setProviderSearch] = useState("")
  const [modelSearch, setModelSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [locale, setLocaleState] = useState<Locale>(getLocale())
  const mountedRef = useRef(false)
  const inFlightRef = useRef(false)
  const isInstallingRef = useRef(false)
  const latestFiltersRef = useRef<DashboardFilters | null>(null)
  const debounceTimerRef = useRef<number | null>(null)

  const filters = useMemo<DashboardFilters>(() => {
    const range = customRange ?? resolveQuickRange(quickRange, new Date(), timezone)

    return {
      ...range,
      ...(selectedProviders.length ? { providers: selectedProviders } : {}),
      ...(selectedModels.length ? { models: selectedModels } : {}),
      recentPage: currentPage,
      recentPageSize: pageSize,
    }
  }, [customRange, quickRange, selectedModels, selectedProviders, timezone, currentPage, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [quickRange, customRange, selectedProviders, selectedModels, pageSize])

  const refreshDashboard = useCallback(async (nextFilters: DashboardFilters, options: { force?: boolean } = {}) => {
    if (!mountedRef.current || inFlightRef.current || (isInstallingRef.current && !options.force)) {
      return
    }

    inFlightRef.current = true
    try {
      const nextDashboard = await window.tokenMetrics.getDashboardData(nextFilters)
      if (mountedRef.current) {
        setDashboard(nextDashboard)
        setError(null)
      }
    } catch (caughtError) {
      if (mountedRef.current) {
        setError(caughtError instanceof Error ? caughtError.message : t("notice.unableLoad"))
      }
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = window.tokenMetrics.onDashboardUpdated(() => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null
        const nextFilters = latestFiltersRef.current
        if (nextFilters) {
          void refreshDashboard(nextFilters)
        }
      }, debounceMs)
    })

    return () => {
      mountedRef.current = false
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
      }
      unsubscribe()
    }
  }, [refreshDashboard])

  useEffect(() => {
    latestFiltersRef.current = filters
    void refreshDashboard(filters)
  }, [filters, refreshDashboard])

  function applyQuickRange(range: QuickRange) {
    setQuickRange(range)
    setCustomRange(null)
    setCustomRangeError(null)
  }

  function changeLocale(next: Locale) {
    setLocale(next)
    setLocaleState(next)
  }

  function updateCustomRange(nextRange: { start: string; end: string }) {
    const validation = validateCustomRange(nextRange.start, nextRange.end)
    if (!validation.valid) {
      setCustomRangeError(validation.message)
      return
    }

    setCustomRangeError(null)
    setCustomRange({ start: validation.start, end: validation.end })
  }

  function updateCalendarRange(nextRange: DateRange | undefined) {
    if (!nextRange?.from) {
      return
    }

    const currentStart = new Date(filters.start)
    const currentEnd = new Date(filters.end)
    const nextStart = new Date(nextRange.from)
    nextStart.setHours(currentStart.getHours(), currentStart.getMinutes(), currentStart.getSeconds(), currentStart.getMilliseconds())

    const nextEnd = new Date(nextRange.to ?? nextRange.from)
    nextEnd.setHours(currentEnd.getHours(), currentEnd.getMinutes(), currentEnd.getSeconds(), currentEnd.getMilliseconds())

    updateCustomRange({ start: toDateTimeLocalValue(nextStart.toISOString()), end: toDateTimeLocalValue(nextEnd.toISOString()) })
  }

  async function handleInstallPlugin() {
    setIsInstalling(true)
    isInstallingRef.current = true
    let shouldRefresh = false
    try {
      await window.tokenMetrics.installPlugin()
      shouldRefresh = true
    } catch (caughtError) {
      if (mountedRef.current) {
        setError(caughtError instanceof Error ? caughtError.message : t("notice.unableInstall"))
      }
    } finally {
      if (shouldRefresh) {
        await refreshDashboard(latestFiltersRef.current ?? filters, { force: true })
      }
      isInstallingRef.current = false
      if (mountedRef.current) {
        setIsInstalling(false)
      }
    }
  }

  useEffect(() => {
    if (!activeFilterTab) return
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [activeFilterTab])

  const visibleModelOptions = useMemo(() => {
    const all = dashboard?.models ?? []
    const map = dashboard?.modelProviders ?? {}
    const enriched = all.map((m) => ({
      ...m,
      providers: map[m.value] ?? [],
    }))
    if (selectedProviders.length === 0) return enriched
    return enriched.filter(
      (m) => m.providers?.some((p) => selectedProviders.includes(p)) ?? false,
    )
  }, [dashboard?.models, dashboard?.modelProviders, selectedProviders])

  const today = dashboard?.today
  const hasMetrics = Boolean(today?.requestCount)
  const rangeStartValue = toDateTimeLocalValue(filters.start)
  const rangeEndValue = toDateTimeLocalValue(filters.end)
  const calendarRange = { from: new Date(filters.start), to: new Date(filters.end) }
  const rangeSummary = `${formatRangeSummary(filters, timezone, quickRange, customRange)} · ${timezone === "utc" ? t("range.timezone.utc") : t("range.timezone.local")}`
  const providersSummary = selectedProviders.length ? selectedProviders.join(" · ") : t("filter.all")
  const modelsSummary = selectedModels.length ? selectedModels.join(" · ") : t("filter.all")
  const intervalSec = dashboard?.trendIntervalSeconds ?? 3600
  const axisLabelOpts: Intl.DateTimeFormatOptions = intervalSec <= 3600
    ? { hour: "2-digit", minute: "2-digit" }
    : intervalSec <= 86400
      ? { hour: "2-digit" }
      : { month: "2-digit", day: "2-digit" }
  const chartTicks = useMemo(() => {
    const startMs = new Date(filters.start).getTime()
    const endMs = new Date(filters.end).getTime()
    const rawStep = (endMs - startMs) / 5
    const stepMs = Math.max(intervalSec * 1000, Math.ceil(rawStep / (intervalSec * 1000)) * intervalSec * 1000)
    const ticks: number[] = []
    for (let ts = Math.ceil(startMs / stepMs) * stepMs; ts <= endMs; ts += stepMs) {
      ticks.push(ts)
    }
    return ticks
  }, [filters.start, filters.end, intervalSec])
  const chartData = useMemo(() => {
    const filled = fillEmptyBuckets(
      dashboard?.hourlyTrends ?? [],
      intervalSec,
      new Date(filters.start).getTime(),
      new Date(filters.end).getTime(),
    )
    return filled.map((row) => ({
      ...row,
      ts: new Date(row.hour).getTime(),
      label: formatTimeInZone(row.hour, timezone, axisLabelOpts),
      fresh: Math.max(0, row.inputTokens - row.cacheTokens),
    }))
  }, [dashboard?.hourlyTrends, intervalSec, filters.start, filters.end, timezone, axisLabelOpts])
  const visibleChartData = chartData.length > 0 ? chartData : emptyChartData
  const spanMinutes = Math.max(1, (new Date(filters.end).getTime() - new Date(filters.start).getTime()) / 60000)
  const tpm = (today?.totalTokens ?? 0) / spanMinutes
  const rpm = (today?.requestCount ?? 0) / spanMinutes
  const recentTotal = dashboard?.recentTotal ?? 0
  const totalPages = Math.max(1, Math.ceil(recentTotal / pageSize))

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">{t("header.eyebrow")}</p>
          <h1>{t("header.title")}</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            title={t("header.settings")}
            type="button"
          >
            ⚙
          </button>
        </div>
      </header>

      {error ? <section className="notice error">{error}</section> : null}
      {dashboard && !dashboard.pluginInstalled ? (
        <section className="notice">{t("notice.pluginRequired")}</section>
      ) : null}

      <section className="filter-panel panel">
        <div className="filter-tabs">
          <button
            className={`filter-tab${activeFilterTab === "range" ? " active" : ""}`}
            onClick={() => setActiveFilterTab((current) => (current === "range" ? null : "range"))}
            type="button"
          >
            <span className="filter-tab-label">{t("filter.range")}</span>
            <small className="filter-tab-value">{rangeSummary}</small>
          </button>
          <button
            className={`filter-tab${activeFilterTab === "providers" ? " active" : ""}`}
            onClick={() => setActiveFilterTab((current) => (current === "providers" ? null : "providers"))}
            type="button"
          >
            <span className="filter-tab-label">{t("filter.providers")}</span>
            <small className="filter-tab-value">{providersSummary}</small>
            {selectedProviders.length ? <span className="filter-tab-tooltip">{selectedProviders.join("\n")}</span> : null}
          </button>
          <button
            className={`filter-tab${activeFilterTab === "models" ? " active" : ""}`}
            onClick={() => setActiveFilterTab((current) => (current === "models" ? null : "models"))}
            type="button"
          >
            <span className="filter-tab-label">{t("filter.models")}</span>
            <small className="filter-tab-value">{modelsSummary}</small>
            {selectedModels.length ? <span className="filter-tab-tooltip">{selectedModels.join("\n")}</span> : null}
          </button>
        </div>
      </section>

      {activeFilterTab === "range" ? (
        <div className="range-overlay" onClick={() => setActiveFilterTab(null)}>
          <div className="range-modal" onClick={(event) => event.stopPropagation()}>
            <div className="range-modal-header">
              <strong>{t("range.selectRange")}</strong>
              <button className="range-close" onClick={() => setActiveFilterTab(null)} type="button">×</button>
            </div>
            <div className="range-shortcuts">
              {quickRanges.map((range) => (
                <button
                  className={range.value === quickRange && !customRange ? "chip active" : "chip"}
                  key={range.value}
                  onClick={() => applyQuickRange(range.value)}
                  type="button"
                >
                  {t(range.labelKey)}
                </button>
              ))}
            </div>
            <DayPicker
              className="token-day-picker"
              mode="range"
              numberOfMonths={2}
              selected={calendarRange}
              showOutsideDays
              onSelect={updateCalendarRange}
            />
            <div className="custom-range-grid">
              <label className="filter-group custom-range-field">
                <span>{t("range.start")}</span>
                <input
                  type="datetime-local"
                  value={rangeStartValue}
                  onChange={(event) => updateCustomRange({ start: event.target.value, end: rangeEndValue })}
                />
              </label>
              <label className="filter-group custom-range-field">
                <span>{t("range.end")}</span>
                <input
                  type="datetime-local"
                  value={rangeEndValue}
                  onChange={(event) => updateCustomRange({ start: rangeStartValue, end: event.target.value })}
                />
              </label>
              <label className="filter-group timezone-select">
                <span>{t("range.timezone")}</span>
                <select value={timezone} onChange={(event) => setTimezone(event.target.value as TimezoneMode)}>
                  <option value="local">{t("range.timezone.local")}</option>
                  <option value="utc">{t("range.timezone.utc")}</option>
                </select>
              </label>
            </div>
            {customRangeError ? <p className="filter-error">{customRangeError}</p> : null}
          </div>
        </div>
      ) : null}

      {activeFilterTab === "providers" ? (
        <SelectOverlay
          label={t("filter.providers")}
          options={dashboard?.providers ?? []}
          search={providerSearch}
          selected={selectedProviders}
          onClose={() => setActiveFilterTab(null)}
          onClear={() => setSelectedProviders([])}
          onSearchChange={setProviderSearch}
          onToggle={(value) => setSelectedProviders((current) => toggleSelection(current, value))}
        />
      ) : null}

      {activeFilterTab === "models" ? (
        <SelectOverlay
          label={t("filter.models")}
          options={visibleModelOptions}
          search={modelSearch}
          selected={selectedModels}
          onClose={() => setActiveFilterTab(null)}
          onClear={() => setSelectedModels([])}
          onSearchChange={setModelSearch}
          onToggle={(value) => setSelectedModels((current) => toggleSelection(current, value))}
        />
      ) : null}

      <section className="panel chart-panel">
        <div className="chart-stats">
          <div className="stat-item">
            <span className="stat-label">{t("stat.total")}</span>
            <strong className="stat-value">{formatTokenUnit(today?.totalTokens ?? 0)}</strong>
            <small className="stat-sub">{formatNumber(today?.requestCount ?? 0)} {t("stat.req")}</small>
          </div>
          <div className="stat-item">
            <span className="stat-label">{t("stat.input")}</span>
            <strong className="stat-value">{formatTokenUnit(today?.inputTokens ?? 0)}</strong>
            <div className="stat-breakdown">
              <small title={t("stat.cacheTitle")}><span className="stat-dot cache" />{formatTokenUnit(today?.cacheTokens ?? 0)}</small>
              <small title={t("stat.freshTitle")}><span className="stat-dot fresh" />{formatTokenUnit(Math.max(0, (today?.inputTokens ?? 0) - (today?.cacheTokens ?? 0)))}</small>
            </div>
          </div>
          <div className="stat-item">
            <span className="stat-label">{t("stat.output")}</span>
            <strong className="stat-value">{formatTokenUnit(today?.outputTokens ?? 0)}</strong>
          </div>
          <div className="stat-item">
            <span className="stat-label">{t("stat.tpm")}</span>
            <strong className="stat-value" title={t("stat.tpmTitle")}>{formatTokenUnit(tpm)}</strong>
            <small className="stat-sub">{rpm.toFixed(2)} {t("stat.rpm")}</small>
          </div>
        </div>
        <div className="chart-frame">
          {chartData.length === 0 ? <div className="chart-empty-overlay">{t("chart.noData")}</div> : null}
            <ResponsiveContainer height={200} width="100%">
              <AreaChart data={visibleChartData} margin={{ bottom: 4, left: 0, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="gradCache" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.06} />
                  </linearGradient>
                  <linearGradient id="gradFresh" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#64748b" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#64748b" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gradOutput" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.06} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.16)" vertical={false} />
                <XAxis type="number" dataKey="ts" domain={["dataMin", "dataMax"]} ticks={chartTicks} axisLine={false} tickLine={false} tickFormatter={(ts) => ts ? formatTimeInZone(new Date(Number(ts)).toISOString(), timezone, axisLabelOpts) : ""} />
                <YAxis axisLine={false} tickFormatter={(value) => formatTokenUnit(Number(value))} tickLine={false} width={44} />
                <Tooltip
                  cursor={{ stroke: "rgba(99, 230, 190, 0.4)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148, 163, 184, 0.28)",
                    borderRadius: 12,
                    color: "#f8fafc",
                    fontSize: "11px",
                  }}
                  formatter={(value, name) => [formatTokenUnit(Number(value)), name]}
                  labelFormatter={(label) => label ? formatTimeInZone(new Date(Number(label)).toISOString(), timezone) : ""}
                />
                <Area activeDot={{ r: 3, strokeWidth: 0 }} dataKey="cacheTokens" name={t("chart.cache")} stackId="tokens" fill="url(#gradCache)" stroke="#22c55e" strokeWidth={1.5} type="monotone" />
                <Area activeDot={{ r: 3, strokeWidth: 0 }} dataKey="fresh" name={t("chart.freshInput")} stackId="tokens" fill="url(#gradFresh)" stroke="#64748b" strokeWidth={1.5} type="monotone" />
                <Area activeDot={{ r: 3, strokeWidth: 0 }} dataKey="outputTokens" name={t("chart.output")} stackId="tokens" fill="url(#gradOutput)" stroke="#38bdf8" strokeWidth={1.5} type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
      </section>

      <section className="panel ranking-panel">
        {dashboard?.modelRanking.length ? (
          <div className="ranking-scroll">
            {dashboard.modelRanking.slice(0, 10).map((model, index) => (
              <div
                className={`rank-card rank-${index + 1}`}
                key={`${model.provider}:${model.model}`}
              >
                <div className="rank-card-header">
                  <div
                    className="rank-card-name"
                    onMouseMove={(e) => setHoveredModel({ x: e.clientX, y: e.clientY, text: `${model.provider} / ${model.model}` })}
                    onMouseLeave={() => setHoveredModel(null)}
                  >
                    <strong>{model.model}</strong>
                    <small>{model.provider}</small>
                  </div>
                  <span className="rank-badge">{index + 1}</span>
                </div>
                <div className="rank-card-stats">
                  <div className="rank-stat">
                    <span className="rank-stat-label">{t("rank.total")}</span>
                    <b>{formatTokenUnit(model.totalTokens)}</b>
                  </div>
                  <div className="rank-stat">
                    <span className="rank-stat-label">{t("rank.input")}</span>
                    <b>{formatTokenUnit(model.inputTokens)}</b>
                  </div>
                  <div className="rank-stat">
                    <span className="rank-stat-label">{t("rank.cache")}</span>
                    <b>{formatTokenUnit(model.cacheTokens)}</b>
                  </div>
                  <div className="rank-stat">
                    <span className="rank-stat-label">{t("rank.output")}</span>
                    <b>{formatTokenUnit(model.outputTokens)}</b>
                  </div>
                  <div className="rank-stat">
                    <span className="rank-stat-label">{t("rank.req")}</span>
                    <b>{formatNumber(model.requestCount)}</b>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t("rank.empty.title")} description={t("rank.empty.description")} />
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t("recent.eyebrow")}</p>
            <h2>{t("recent.title")}</h2>
          </div>
          <small className="recent-total">{t("recent.total", { count: formatNumber(recentTotal) })}</small>
        </div>
        {dashboard?.recent.length ? (
          <>
            <div className="request-list">
              <div className="req-header">
                <span className="req-col-time" title={t("recent.time")}>{t("recent.time")}</span>
                <span className="req-col-model" title={t("recent.model")}>{t("recent.model")}</span>
                <span className="req-col-provider" title={t("recent.provider")}>{t("recent.provider")}</span>
                <span className="req-col-total" title={t("recent.totalTokens")}>{t("stat.total")}</span>
                <span className="req-col-input" title={t("recent.inputTokens")}>{t("stat.input")}</span>
                <span className="req-col-cache" title={t("recent.cacheTokens")}>{t("stat.cache")}</span>
                <span className="req-col-output" title={t("recent.outputTokens")}>{t("stat.output")}</span>
                <span className="req-col-duration" title={t("recent.duration")}>{t("recent.duration")}</span>
                <span className="req-col-ttft" title={t("recent.ttft")}>{t("recent.ttftShort")}</span>
              </div>
              {dashboard.recent.map((request) => (
                <div className="request-row" key={request.id}>
                  <TipCell onHover={setCellTip} className="req-col-time" tip={formatTimeInZone(request.timestamp, timezone)}>
                    {formatRequestTime(request.timestamp, timezone)}
                  </TipCell>
                  <TipCell onHover={setCellTip} className="req-col-model" tip={`${request.provider} / ${request.model}`}>{request.model}</TipCell>
                  <TipCell onHover={setCellTip} className="req-col-provider" tip={request.provider}>{request.provider}</TipCell>
                  <TipCell onHover={setCellTip} className="req-col-total" tip={`${formatTokenUnit(request.totalTokens)} (${t("stat.total")})`}>{formatTokenUnit(request.totalTokens)}</TipCell>
                  <TipCell onHover={setCellTip} className="req-col-input" tip={`${formatTokenUnit(request.inputTokens)} (${t("stat.input")})`}>{formatTokenUnit(request.inputTokens)}</TipCell>
                  <TipCell onHover={setCellTip} className="req-col-cache" tip={request.cacheTokens > 0 ? `${formatTokenUnit(request.cacheTokens)} (${t("stat.cache")})` : "-"}>{request.cacheTokens > 0 ? formatTokenUnit(request.cacheTokens) : "-"}</TipCell>
                  <TipCell onHover={setCellTip} className="req-col-output" tip={`${formatTokenUnit(request.outputTokens)} (${t("stat.output")})`}>{formatTokenUnit(request.outputTokens)}</TipCell>
                  <TipCell onHover={setCellTip} className="req-col-duration" tip={request.durationMs > 0 ? formatDuration(request.durationMs) : "-"}>{request.durationMs > 0 ? formatDuration(request.durationMs) : "-"}</TipCell>
                  <TipCell onHover={setCellTip} className="req-col-ttft" tip={request.firstTokenLatencyMs != null ? formatDuration(request.firstTokenLatencyMs) : "-"}>{request.firstTokenLatencyMs != null ? formatDuration(request.firstTokenLatencyMs) : "-"}</TipCell>
                </div>
              ))}
            </div>
            <div className="pagination">
              <div className="pagination-nav">
                <button
                  className="page-button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  type="button"
                >
                  ‹
                </button>
                <span className="page-info">{currentPage} / {totalPages}</span>
                <button
                  className="page-button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  type="button"
                >
                  ›
                </button>
              </div>
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
            </div>
          </>
        ) : (
          <EmptyState title={t("recent.empty.title")} description={t("recent.empty.description")} />
        )}
      </section>

      {settingsOpen ? (
        <div className="range-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="range-modal-header">
              <strong>{t("settings.title")}</strong>
              <button className="range-close" onClick={() => setSettingsOpen(false)} type="button">×</button>
            </div>
            <span className={dashboard?.pluginInstalled ? "status-pill installed" : "status-pill"}>
              {dashboard?.pluginInstalled ? t("settings.pluginInstalled") : t("settings.pluginNotInstalled")}
            </span>
            <button className="primary-button settings-install" disabled={isInstalling} onClick={handleInstallPlugin} type="button">
              {isInstalling ? t("settings.installing") : dashboard?.pluginInstalled ? t("settings.reinstall") : t("settings.install")}
            </button>
            <dl className="settings-list">
              <div>
                <dt>{t("settings.plugin")}</dt>
                <dd>{dashboard?.paths?.pluginPath ?? t("settings.unavailable")}</dd>
              </div>
              <div>
                <dt>{t("settings.jsonl")}</dt>
                <dd>{dashboard?.paths?.jsonlPath ?? t("settings.unavailable")}</dd>
              </div>
              <div>
                <dt>{t("settings.sqlite")}</dt>
                <dd>{dashboard?.paths?.sqlitePath ?? t("settings.unavailable")}</dd>
              </div>
              <div>
                <dt>{t("settings.importErrors")}</dt>
                <dd>{formatNumber(dashboard?.importErrors ?? 0)}</dd>
              </div>
            </dl>
            <div className="settings-language">
              <dt>{t("settings.language")}</dt>
              <div className="lang-buttons">
                <button className={locale === "en" ? "active" : ""} onClick={() => changeLocale("en")} type="button">{t("settings.language.en")}</button>
                <button className={locale === "zh" ? "active" : ""} onClick={() => changeLocale("zh")} type="button">{t("settings.language.zh")}</button>
              </div>
            </div>
            <p className="restart-hint">{t("settings.restartHint")}</p>
          </div>
        </div>
      ) : null}

      {dashboard ? <span className="sr-only">{hasMetrics ? t("dashboard.loadedWithMetrics") : t("dashboard.loadedNoMetrics")}</span> : null}

      {hoveredModel ? (
        <div className="floating-tooltip" style={{ left: hoveredModel.x, top: hoveredModel.y - 36 }}>
          {hoveredModel.text}
        </div>
      ) : null}

      {cellTip ? (
        <div className="floating-tooltip" style={{ left: cellTip.x, top: cellTip.y + 16 }}>
          {cellTip.text}
        </div>
      ) : null}
    </main>
  )
}

function SelectOverlay({
  label,
  options,
  search,
  selected,
  onClose,
  onClear,
  onSearchChange,
  onToggle,
}: {
  label: string
  options: FilterOption[]
  search: string
  selected: string[]
  onClose: () => void
  onClear: () => void
  onSearchChange: (value: string) => void
  onToggle: (value: string) => void
}) {
  const normalizedSearch = search.trim().toLowerCase()
  const optionValues = new Set(options.map((option) => option.value))
  const missingSelectedOptions = selected
    .filter((value) => !optionValues.has(value))
    .map((value) => ({ requestCount: 0, totalTokens: 0, value, providers: [] as string[] }))
  const visibleOptions = [...missingSelectedOptions, ...options]
    .filter((option) => option.value.toLowerCase().includes(normalizedSearch))

  return (
    <div className="range-overlay" onClick={onClose}>
      <div className="select-modal" onClick={(event) => event.stopPropagation()}>
        <div className="range-modal-header">
          <strong>{label}</strong>
          <button className="range-close" onClick={onClose} type="button">×</button>
        </div>
        <input
          autoFocus
          aria-label={t("selectOverlay.search", { label: label.toLowerCase() })}
          className="select-search"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("selectOverlay.search", { label: label.toLowerCase() })}
          type="search"
          value={search}
        />
        <div className="select-list">
          {visibleOptions.length ? visibleOptions.map((option) => {
            const isSelected = selected.includes(option.value)
            const hasMatches = optionValues.has(option.value)

            return (
              <button
                className={`select-item${isSelected ? " active" : ""}${hasMatches ? "" : " missing"}`}
                key={option.value}
                onClick={() => onToggle(option.value)}
                type="button"
              >
                <span className={`select-check${isSelected ? " checked" : ""}`} />
                <div className="select-item-info">
                  <span className="select-item-label">{option.value}</span>
                  {option.providers?.length ? (
                    <span className="select-item-providers">{option.providers.join(" · ")}</span>
                  ) : null}
                </div>
                <small className="select-item-meta">{hasMatches ? formatTokenUnit(option.totalTokens) : "0"}</small>
              </button>
            )
          }) : <span className="empty-options">{t("selectOverlay.noOptions")}</span>}
        </div>
        <div className="select-actions">
          <button disabled={!selected.length} onClick={onClear} type="button">{t("selectOverlay.clearAll")}</button>
          <button className="primary-button" onClick={onClose} type="button">{t("selectOverlay.done")}</button>
        </div>
      </div>
    </div>
  )
}

function toggleSelection(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}

function TipCell({ className, tip, children, onHover }: { className?: string; tip: string; children: React.ReactNode; onHover: (pos: { x: number; y: number; text: string } | null) => void }) {
  return (
    <span
      className={className}
      onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, text: tip })}
      onMouseLeave={() => onHover(null)}
    >
      {children}
    </span>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-card">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}

const pageSizeOptions = [10, 20, 50, 100, 200]

function PageSizeSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="page-size-wrapper">
      <button className="page-size-trigger" onClick={() => setOpen((o) => !o)} type="button">
        {t("recent.pageSize", { size: value })}
        <span className="page-size-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <>
          <div className="page-size-backdrop" onClick={() => setOpen(false)} />
          <div className="page-size-dropdown">
            {pageSizeOptions.map((opt) => (
              <button
                className={`page-size-option${opt === value ? " active" : ""}`}
                key={opt}
                onClick={() => { onChange(opt); setOpen(false) }}
                type="button"
              >
                {t("recent.pageSize", { size: opt })}
                {opt === value ? <span className="page-size-check">✓</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
