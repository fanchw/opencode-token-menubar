import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { TodaySummary } from "../../shared/metrics.js"
import { formatTokenUnit } from "../../shared/metrics.js"
import { t } from "../i18n.js"
import { formatTimeInZone } from "../timeFilters.js"
import type { TimezoneMode } from "../timeFilters.js"
import { formatNumber } from "../utils.js"

export interface ChartPoint {
  hour: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  averageTokensPerSecond: number
  ts: number
  label: string
  fresh: number
}

export interface ChartPanelProps {
  today: TodaySummary | undefined
  chartData: ChartPoint[]
  visibleChartData: Array<{ hour: string; ts: number; label: string; totalTokens?: number; cacheTokens?: number; fresh?: number; outputTokens?: number }>
  chartTicks: number[]
  axisLabelOpts: Intl.DateTimeFormatOptions
  timezone: TimezoneMode
  tpm: number
  rpm: number
}

export function ChartPanel({
  today,
  chartData,
  visibleChartData,
  chartTicks,
  axisLabelOpts,
  timezone,
  tpm,
  rpm,
}: ChartPanelProps) {
  return (
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
  )
}
