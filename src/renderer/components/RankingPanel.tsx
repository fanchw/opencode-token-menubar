import type { ModelRankingRow } from "../../shared/metrics.js"
import { formatTokenUnit } from "../../shared/metrics.js"
import { t } from "../i18n.js"
import { formatNumber } from "../utils.js"
import { EmptyState, type HoverTip } from "./shared.js"

export interface RankingPanelProps {
  modelRanking: ModelRankingRow[]
  onHoverModel: (pos: HoverTip | null) => void
}

export function RankingPanel({ modelRanking, onHoverModel }: RankingPanelProps) {
  return (
    <section className="panel ranking-panel">
      {modelRanking.length ? (
        <div className="ranking-scroll">
          {modelRanking.slice(0, 10).map((model, index) => (
            <div
              className={`rank-card rank-${index + 1}`}
              key={`${model.provider}:${model.model}`}
            >
              <div className="rank-card-header">
                <div
                  className="rank-card-name"
                  onMouseMove={(e) => onHoverModel({ x: e.clientX, y: e.clientY, text: `${model.provider} / ${model.model}` })}
                  onMouseLeave={() => onHoverModel(null)}
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
  )
}
