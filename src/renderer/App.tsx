import { useEffect, useRef, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { DashboardData } from "../shared/metrics.js"

const refreshIntervalMs = 2_000

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Number.isFinite(value) ? Math.round(value) : 0)
}

function formatSpeed(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : "0.0"} tok/s`
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatHour(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
  }).format(new Date(value))
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const mountedRef = useRef(false)
  const inFlightRef = useRef(false)
  const isInstallingRef = useRef(false)

  async function refreshDashboard(options: { force?: boolean } = {}) {
    if (!mountedRef.current || inFlightRef.current || (isInstallingRef.current && !options.force)) {
      return
    }

    inFlightRef.current = true
    try {
      const nextDashboard = await window.tokenMetrics.getDashboardData()
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
  }

  useEffect(() => {
    mountedRef.current = true
    void refreshDashboard()
    const timer = window.setInterval(() => void refreshDashboard(), refreshIntervalMs)

    return () => {
      mountedRef.current = false
      window.clearInterval(timer)
    }
  }, [])

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
        await refreshDashboard({ force: true })
      }
      isInstallingRef.current = false
      if (mountedRef.current) {
        setIsInstalling(false)
      }
    }
  }

  const today = dashboard?.today
  const hasMetrics = Boolean(today?.requestCount)
  const chartData = dashboard?.hourlyTrends.map((row) => ({
    ...row,
    label: formatHour(row.hour),
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

      <section className="summary-grid">
        <article className="metric-card">
          <span>Total Tokens</span>
          <strong>{formatNumber(today?.totalTokens ?? 0)}</strong>
          <small>{formatNumber(today?.requestCount ?? 0)} requests today</small>
        </article>
        <article className="metric-card">
          <span>Input Tokens</span>
          <strong>{formatNumber(today?.inputTokens ?? 0)}</strong>
          <small>Prompt usage</small>
        </article>
        <article className="metric-card">
          <span>Output Tokens</span>
          <strong>{formatNumber(today?.outputTokens ?? 0)}</strong>
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
                  formatter={(value) => [formatNumber(Number(value)), "tokens"]}
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
                    <b>{formatNumber(model.totalTokens)}</b>
                    <span>{model.requestCount} req</span>
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
                    <span>{request.provider} · {formatTime(request.timestamp)}</span>
                  </div>
                  <div className="row-metrics">
                    <b>{formatNumber(request.totalTokens)}</b>
                    <span>{formatNumber(request.inputTokens)} in</span>
                    <span>{formatNumber(request.outputTokens)} out</span>
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

      {dashboard && !hasMetrics ? null : <span className="sr-only">Dashboard loaded</span>}
    </main>
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
