import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

const debounceMs = 120

const quickRanges: Array<{ label: string; value: QuickRange }> = [
  { label: "Today", value: "today" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
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

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [quickRange, setQuickRange] = useState<QuickRange>("today")
  const [timezone, setTimezone] = useState<TimezoneMode>("local")
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null)
  const [customRangeError, setCustomRangeError] = useState<string | null>(null)
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [providerSearch, setProviderSearch] = useState("")
  const [modelSearch, setModelSearch] = useState("")
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
    }
  }, [customRange, quickRange, selectedModels, selectedProviders, timezone])

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
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load dashboard data")
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

  function updateCustomRange(nextRange: { start: string; end: string }) {
    const validation = validateCustomRange(nextRange.start, nextRange.end)
    if (!validation.valid) {
      setCustomRangeError(validation.message)
      return
    }

    setCustomRangeError(null)
    setCustomRange({ start: validation.start, end: validation.end })
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
        setError(caughtError instanceof Error ? caughtError.message : "Unable to install plugin")
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

  const today = dashboard?.today
  const hasMetrics = Boolean(today?.requestCount)
  const rangeStartValue = toDateTimeLocalValue(filters.start)
  const rangeEndValue = toDateTimeLocalValue(filters.end)
  const chartData = dashboard?.hourlyTrends.map((row) => ({
    ...row,
    label: formatTimeInZone(row.hour, timezone, { hour: "2-digit" }),
  })) ?? []

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">OpenCode</p>
          <h1>Token Metrics</h1>
          <p className="header-copy">Live token usage, model mix, and throughput for today's requests.</p>
        </div>
        <button className="primary-button" disabled={isInstalling} onClick={handleInstallPlugin} type="button">
          {isInstalling ? "Installing..." : dashboard?.pluginInstalled ? "Reinstall Plugin" : "Install Plugin"}
        </button>
      </header>

      {error ? <section className="notice error">{error}</section> : null}
      {dashboard && !dashboard.pluginInstalled ? (
        <section className="notice">Install the plugin, then restart OpenCode to start collecting metrics.</section>
      ) : null}

      <section className="filter-panel panel">
        <div className="filter-group quick-range-group">
          <span>Range</span>
          <div className="chip-row">
            {quickRanges.map((range) => (
              <button
                className={range.value === quickRange ? "chip active" : "chip"}
                key={range.value}
                onClick={() => applyQuickRange(range.value)}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        <label className="filter-group timezone-select">
          <span>Timezone</span>
          <select value={timezone} onChange={(event) => setTimezone(event.target.value as TimezoneMode)}>
            <option value="local">Local</option>
            <option value="utc">UTC</option>
          </select>
        </label>
        <div className="custom-range-grid">
          <label className="filter-group custom-range-field">
            <span>Start</span>
            <input
              type="datetime-local"
              value={rangeStartValue}
              onChange={(event) => updateCustomRange({ start: event.target.value, end: rangeEndValue })}
            />
          </label>
          <label className="filter-group custom-range-field">
            <span>End</span>
            <input
              type="datetime-local"
              value={rangeEndValue}
              onChange={(event) => updateCustomRange({ start: rangeStartValue, end: event.target.value })}
            />
          </label>
        </div>
        {customRangeError ? <p className="filter-error">{customRangeError}</p> : null}
        <MultiSelect
          label="Providers"
          options={dashboard?.providers ?? []}
          search={providerSearch}
          selected={selectedProviders}
          onClear={() => setSelectedProviders([])}
          onSearchChange={setProviderSearch}
          onToggle={(value) => setSelectedProviders((current) => toggleSelection(current, value))}
        />
        <MultiSelect
          label="Models"
          options={dashboard?.models ?? []}
          search={modelSearch}
          selected={selectedModels}
          onClear={() => setSelectedModels([])}
          onSearchChange={setModelSearch}
          onToggle={(value) => setSelectedModels((current) => toggleSelection(current, value))}
        />
      </section>

      <section className="summary-grid">
        <article className="metric-card">
          <span>Total Tokens</span>
          <strong>{formatTokenUnit(today?.totalTokens ?? 0)}</strong>
          <small>{formatNumber(today?.requestCount ?? 0)} requests</small>
        </article>
        <article className="metric-card">
          <span>Input Tokens</span>
          <strong>{formatTokenUnit(today?.inputTokens ?? 0)}</strong>
          <small>Prompt usage</small>
        </article>
        <article className="metric-card">
          <span>Output Tokens</span>
          <strong>{formatTokenUnit(today?.outputTokens ?? 0)}</strong>
          <small>Completion usage</small>
        </article>
        <article className="metric-card">
          <span>Avg Speed</span>
          <strong>{formatSpeed(today?.averageTokensPerSecond ?? 0)}</strong>
          <small>Tokens per second</small>
        </article>
      </section>

      <section className="panel chart-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Hourly Trends</p>
            <h2>Token volume</h2>
          </div>
        </div>
        {chartData.length > 0 ? (
          <div className="chart-frame">
            <ResponsiveContainer height={220} width="100%">
              <AreaChart data={chartData} margin={{ bottom: 0, left: 0, right: 8, top: 10 }}>
                <defs>
                  <linearGradient id="tokenGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.55} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.16)" vertical={false} />
                <XAxis axisLine={false} dataKey="label" tickLine={false} />
                <YAxis axisLine={false} tickFormatter={formatNumber} tickLine={false} width={64} />
                <Tooltip
                  contentStyle={{
                    background: "#0f172a",
                    border: "1px solid rgba(148, 163, 184, 0.28)",
                    borderRadius: 12,
                    color: "#f8fafc",
                  }}
                  formatter={(value) => [formatTokenUnit(Number(value)), "tokens"]}
                  labelFormatter={(_, payload) => payload[0]?.payload.hour ?? ""}
                />
                <Area dataKey="totalTokens" fill="url(#tokenGradient)" stroke="#38bdf8" strokeWidth={2} type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState title="No hourly data" description="Run a model request to populate today's trend chart." />
        )}
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Model Ranking</p>
              <h2>Top models</h2>
            </div>
          </div>
          {dashboard?.modelRanking.length ? (
            <div className="ranking-list">
              {dashboard.modelRanking.map((model) => (
                <div className="ranking-row" key={`${model.provider}:${model.model}`}>
                  <div>
                    <strong>{model.model}</strong>
                    <span>{model.provider}</span>
                  </div>
                  <div className="row-metrics">
                    <b>{formatTokenUnit(model.totalTokens)}</b>
                    <span>{formatNumber(model.requestCount)} req</span>
                    <span>{formatSpeed(model.averageTokensPerSecond)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No ranked models" description="Model usage appears after the first imported request." />
          )}
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent Requests</p>
              <h2>Latest activity</h2>
            </div>
          </div>
          {dashboard?.recent.length ? (
            <div className="request-list">
              {dashboard.recent.map((request) => (
                <div className="request-row" key={request.id}>
                  <div>
                    <strong>{request.model}</strong>
                    <span>{request.provider} · {formatTimeInZone(request.timestamp, timezone)}</span>
                  </div>
                  <div className="row-metrics">
                    <b>{formatTokenUnit(request.totalTokens)}</b>
                    <span>{formatTokenUnit(request.inputTokens)} in</span>
                    <span>{formatTokenUnit(request.outputTokens)} out</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No recent requests" description="Install the plugin, restart OpenCode, then run a model request." />
          )}
        </article>
      </section>

      <section className="panel settings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Local paths</h2>
          </div>
          <span className={dashboard?.pluginInstalled ? "status-pill installed" : "status-pill"}>
            {dashboard?.pluginInstalled ? "Plugin installed" : "Plugin not installed"}
          </span>
        </div>
        <dl className="settings-list">
          <div>
            <dt>Plugin</dt>
            <dd>{dashboard?.paths?.pluginPath ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>JSONL</dt>
            <dd>{dashboard?.paths?.jsonlPath ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>SQLite</dt>
            <dd>{dashboard?.paths?.sqlitePath ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Import Errors</dt>
            <dd>{formatNumber(dashboard?.importErrors ?? 0)}</dd>
          </div>
        </dl>
        <p className="restart-hint">Restart OpenCode after installing or reinstalling the plugin.</p>
      </section>

      {dashboard ? <span className="sr-only">Dashboard loaded{hasMetrics ? " with metrics" : " with no metrics"}</span> : null}
    </main>
  )
}

function MultiSelect({
  label,
  options,
  search,
  selected,
  onClear,
  onSearchChange,
  onToggle,
}: {
  label: string
  options: FilterOption[]
  search: string
  selected: string[]
  onClear: () => void
  onSearchChange: (value: string) => void
  onToggle: (value: string) => void
}) {
  const normalizedSearch = search.trim().toLowerCase()
  const optionValues = new Set(options.map((option) => option.value))
  const missingSelectedOptions = selected
    .filter((value) => !optionValues.has(value))
    .map((value) => ({ requestCount: 0, totalTokens: 0, value }))
  const visibleOptions = [...missingSelectedOptions, ...options]
    .filter((option) => option.value.toLowerCase().includes(normalizedSearch))

  return (
    <div className="multi-select filter-group">
      <div className="multi-select-header">
        <span>{label}</span>
        <button disabled={!selected.length} onClick={onClear} type="button">
          Clear
        </button>
      </div>
      <input
        aria-label={`Search ${label.toLowerCase()}`}
        className="multi-select-search"
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={`Search ${label.toLowerCase()}`}
        type="search"
        value={search}
      />
      <div className="option-chip-row">
        {visibleOptions.length ? visibleOptions.map((option) => {
          const isSelected = selected.includes(option.value)
          const hasMatches = optionValues.has(option.value)

          return (
            <button
              className={`${isSelected ? "option-chip active" : "option-chip"}${hasMatches ? "" : " missing"}`}
              key={option.value}
              onClick={() => onToggle(option.value)}
              type="button"
            >
              <span>{option.value}</span>
              <small>{hasMatches ? formatTokenUnit(option.totalTokens) : "no matches"}</small>
            </button>
          )
        }) : <span className="empty-options">No options</span>}
      </div>
    </div>
  )
}

function toggleSelection(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-card">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}
