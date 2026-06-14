import type { MetricEvent } from "../../shared/metrics.js"
import { formatTokenUnit } from "../../shared/metrics.js"
import { t } from "../i18n.js"
import { formatTimeInZone } from "../timeFilters.js"
import type { TimezoneMode } from "../timeFilters.js"
import { formatDuration, formatNumber, formatRequestTime } from "../utils.js"
import { EmptyState, PageSizeSelect, TipCell, type HoverTip } from "./shared.js"

export interface RequestListProps {
  recent: MetricEvent[]
  recentTotal: number
  timezone: TimezoneMode
  currentPage: number
  pageSize: number
  totalPages: number
  setCurrentPage: (fn: (p: number) => number) => void
  setPageSize: (size: number) => void
  onCellTip: (pos: HoverTip | null) => void
}

export function RequestList({
  recent,
  recentTotal,
  timezone,
  currentPage,
  pageSize,
  totalPages,
  setCurrentPage,
  setPageSize,
  onCellTip,
}: RequestListProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t("recent.eyebrow")}</p>
          <h2>{t("recent.title")}</h2>
        </div>
        <small className="recent-total">{t("recent.total", { count: formatNumber(recentTotal) })}</small>
      </div>
      {recent.length ? (
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
            {recent.map((request) => (
              <div className="request-row" key={request.id}>
                <TipCell onHover={onCellTip} className="req-col-time" tip={formatTimeInZone(request.timestamp, timezone)}>
                  {formatRequestTime(request.timestamp, timezone)}
                </TipCell>
                <TipCell onHover={onCellTip} className="req-col-model" tip={`${request.provider} / ${request.model}`}>{request.model}</TipCell>
                <TipCell onHover={onCellTip} className="req-col-provider" tip={request.provider}>{request.provider}</TipCell>
                <TipCell onHover={onCellTip} className="req-col-total" tip={`${formatTokenUnit(request.totalTokens)} (${t("stat.total")})`}>{formatTokenUnit(request.totalTokens)}</TipCell>
                <TipCell onHover={onCellTip} className="req-col-input" tip={`${formatTokenUnit(request.inputTokens)} (${t("stat.input")})`}>{formatTokenUnit(request.inputTokens)}</TipCell>
                <TipCell onHover={onCellTip} className="req-col-cache" tip={request.cacheTokens > 0 ? `${formatTokenUnit(request.cacheTokens)} (${t("stat.cache")})` : "-"}>{request.cacheTokens > 0 ? formatTokenUnit(request.cacheTokens) : "-"}</TipCell>
                <TipCell onHover={onCellTip} className="req-col-output" tip={`${formatTokenUnit(request.outputTokens)} (${t("stat.output")})`}>{formatTokenUnit(request.outputTokens)}</TipCell>
                <TipCell onHover={onCellTip} className="req-col-duration" tip={request.durationMs > 0 ? formatDuration(request.durationMs) : "-"}>{request.durationMs > 0 ? formatDuration(request.durationMs) : "-"}</TipCell>
                <TipCell onHover={onCellTip} className="req-col-ttft" tip={request.firstTokenLatencyMs != null ? formatDuration(request.firstTokenLatencyMs) : "-"}>{request.firstTokenLatencyMs != null ? formatDuration(request.firstTokenLatencyMs) : "-"}</TipCell>
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
  )
}
