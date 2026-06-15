import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { DashboardData, DashboardFilters } from "../shared/metrics.js"
import { formatTimeInZone, resolveQuickRange, validateCustomRange } from "./timeFilters.js"
import type { QuickRange, TimezoneMode } from "./timeFilters.js"
import { t, getLocale, setLocale, type Locale } from "./i18n.js"
import { debounceMs, emptyChartData, fillEmptyBuckets, formatRangeSummary, toDateTimeLocalValue, toggleSelection } from "./utils.js"
import { ChartPanel, type ChartPoint } from "./components/ChartPanel.js"
import { FilterBar } from "./components/FilterBar.js"
import { RankingPanel } from "./components/RankingPanel.js"
import { RequestList } from "./components/RequestList.js"
import { SettingsModal } from "./components/SettingsModal.js"
import type { HoverTip } from "./components/shared.js"

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [quickRange, setQuickRange] = useState<QuickRange>("today")
  const [timezone, setTimezone] = useState<TimezoneMode>("local")
  const [activeFilterTab, setActiveFilterTab] = useState<"range" | "providers" | "models" | null>(null)
  const [hoveredModel, setHoveredModel] = useState<HoverTip | null>(null)
  const [cellTip, setCellTip] = useState<HoverTip | null>(null)
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
  const throttleTimerRef = useRef<number | null>(null)
  const lastFireRef = useRef(0)
  const lastHeavyRefreshRef = useRef(0)

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

  const refreshSummary = useCallback(async (nextFilters: DashboardFilters) => {
    if (!mountedRef.current) return

    try {
      const [summary, recent] = await Promise.all([
        window.tokenMetrics.getSummary(nextFilters),
        window.tokenMetrics.getRecent(nextFilters),
      ])
      if (mountedRef.current && latestFiltersRef.current === nextFilters) {
        setDashboard((prev) => prev ? {
          ...prev,
          today: summary.today,
          providers: summary.providers,
          models: summary.models,
          modelProviders: summary.modelProviders,
          importErrors: summary.importErrors,
          pluginInstalled: summary.pluginInstalled,
          paths: summary.paths,
          recent: recent.rows,
          recentTotal: recent.total,
        } : null)
        setError(null)
      }
    } catch (caughtError) {
      if (mountedRef.current && latestFiltersRef.current === nextFilters) {
        setError(caughtError instanceof Error ? caughtError.message : t("notice.unableLoad"))
      }
    }
  }, [])

  const refreshHeavy = useCallback(async (nextFilters: DashboardFilters) => {
    if (!mountedRef.current) return

    try {
      const [ranking, trends] = await Promise.all([
        window.tokenMetrics.getRanking(nextFilters),
        window.tokenMetrics.getTrends(nextFilters),
      ])
      if (mountedRef.current) {
        setDashboard((prev) => prev ? {
          ...prev,
          modelRanking: ranking,
          hourlyTrends: trends.trends,
          trendIntervalSeconds: trends.trendIntervalSeconds,
        } : null)
      }
    } catch {
      // heavy refresh 失败不阻塞 UI
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const throttleMs = 500

    function fireRefresh() {
      const nextFilters = latestFiltersRef.current
      if (!nextFilters) return

      void refreshSummary(nextFilters)

      const now = Date.now()
      if (now - lastHeavyRefreshRef.current >= 2000) {
        lastHeavyRefreshRef.current = now
        void refreshHeavy(nextFilters)
      }
    }

    const unsubscribe = window.tokenMetrics.onDashboardUpdated(() => {
      const now = Date.now()
      if (now - lastFireRef.current >= throttleMs) {
        lastFireRef.current = now
        fireRefresh()
      } else if (throttleTimerRef.current === null) {
        const remaining = throttleMs - (now - lastFireRef.current)
        throttleTimerRef.current = window.setTimeout(() => {
          throttleTimerRef.current = null
          lastFireRef.current = Date.now()
          fireRefresh()
        }, remaining)
      }
    })

    return () => {
      mountedRef.current = false
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current)
      }
      unsubscribe()
    }
  }, [refreshDashboard, refreshSummary, refreshHeavy])

  useEffect(() => {
    latestFiltersRef.current = filters
    lastFireRef.current = 0
    lastHeavyRefreshRef.current = 0
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

  function updateCalendarRange(nextRange: { from?: Date; to?: Date } | undefined) {
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
  const chartData = useMemo<ChartPoint[]>(() => {
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

      <FilterBar
        activeFilterTab={activeFilterTab}
        setActiveFilterTab={setActiveFilterTab}
        rangeSummary={rangeSummary}
        providersSummary={providersSummary}
        modelsSummary={modelsSummary}
        selectedProviders={selectedProviders}
        selectedModels={selectedModels}
        quickRange={quickRange}
        customRange={customRange}
        customRangeError={customRangeError}
        timezone={timezone}
        filters={filters}
        applyQuickRange={applyQuickRange}
        updateCustomRange={updateCustomRange}
        updateCalendarRange={updateCalendarRange}
        setTimezone={setTimezone}
        providers={dashboard?.providers ?? []}
        models={visibleModelOptions}
        providerSearch={providerSearch}
        modelSearch={modelSearch}
        setProviderSearch={setProviderSearch}
        setModelSearch={setModelSearch}
        onToggleProvider={(value) => setSelectedProviders((current) => toggleSelection(current, value))}
        onToggleModel={(value) => setSelectedModels((current) => toggleSelection(current, value))}
        onClearProviders={() => setSelectedProviders([])}
        onClearModels={() => setSelectedModels([])}
      />

      <ChartPanel
        today={today}
        chartData={chartData}
        visibleChartData={visibleChartData}
        chartTicks={chartTicks}
        axisLabelOpts={axisLabelOpts}
        timezone={timezone}
        tpm={tpm}
        rpm={rpm}
      />

      <RankingPanel
        modelRanking={dashboard?.modelRanking ?? []}
        onHoverModel={setHoveredModel}
      />

      <RequestList
        recent={dashboard?.recent ?? []}
        recentTotal={recentTotal}
        timezone={timezone}
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        setCurrentPage={setCurrentPage}
        setPageSize={setPageSize}
        onCellTip={setCellTip}
      />

      {settingsOpen ? (
        <SettingsModal
          dashboard={dashboard}
          isInstalling={isInstalling}
          locale={locale}
          onInstall={handleInstallPlugin}
          onLocaleChange={changeLocale}
          onClose={() => setSettingsOpen(false)}
        />
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
