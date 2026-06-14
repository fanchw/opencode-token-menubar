import type { FilterOption } from "../../shared/metrics.js"
import { formatTokenUnit } from "../../shared/metrics.js"
import { t } from "../i18n.js"

export interface SelectOverlayProps {
  label: string
  options: FilterOption[]
  search: string
  selected: string[]
  onClose: () => void
  onClear: () => void
  onSearchChange: (value: string) => void
  onToggle: (value: string) => void
}

export function SelectOverlay({
  label,
  options,
  search,
  selected,
  onClose,
  onClear,
  onSearchChange,
  onToggle,
}: SelectOverlayProps) {
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
