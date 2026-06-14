import { DayPicker } from "react-day-picker"
import type { DateRange } from "react-day-picker"
import "react-day-picker/style.css"

import type { DashboardFilters, FilterOption } from "../../shared/metrics.js"
import { t } from "../i18n.js"
import type { QuickRange, TimezoneMode } from "../timeFilters.js"
import { quickRanges, toDateTimeLocalValue } from "../utils.js"
import { SelectOverlay } from "./SelectOverlay.js"
import { DropdownSelect } from "./shared.js"

export interface FilterBarProps {
  activeFilterTab: "range" | "providers" | "models" | null
  setActiveFilterTab: (tab: "range" | "providers" | "models" | null) => void
  rangeSummary: string
  providersSummary: string
  modelsSummary: string
  selectedProviders: string[]
  selectedModels: string[]
  quickRange: QuickRange
  customRange: { start: string; end: string } | null
  customRangeError: string | null
  timezone: TimezoneMode
  filters: DashboardFilters
  applyQuickRange: (range: QuickRange) => void
  updateCustomRange: (range: { start: string; end: string }) => void
  updateCalendarRange: (range: DateRange | undefined) => void
  setTimezone: (tz: TimezoneMode) => void
  providers: FilterOption[]
  models: FilterOption[]
  providerSearch: string
  modelSearch: string
  setProviderSearch: (value: string) => void
  setModelSearch: (value: string) => void
  onToggleProvider: (value: string) => void
  onToggleModel: (value: string) => void
  onClearProviders: () => void
  onClearModels: () => void
}

export function FilterBar({
  activeFilterTab,
  setActiveFilterTab,
  rangeSummary,
  providersSummary,
  modelsSummary,
  selectedProviders,
  selectedModels,
  quickRange,
  customRange,
  customRangeError,
  timezone,
  filters,
  applyQuickRange,
  updateCustomRange,
  updateCalendarRange,
  setTimezone,
  providers,
  models,
  providerSearch,
  modelSearch,
  setProviderSearch,
  setModelSearch,
  onToggleProvider,
  onToggleModel,
  onClearProviders,
  onClearModels,
}: FilterBarProps) {
  const rangeStartValue = toDateTimeLocalValue(filters.start)
  const rangeEndValue = toDateTimeLocalValue(filters.end)
  const calendarRange = { from: new Date(filters.start), to: new Date(filters.end) }

  return (
    <>
      <section className="filter-panel panel">
        <div className="filter-tabs">
          <button
            className={`filter-tab${activeFilterTab === "range" ? " active" : ""}`}
            onClick={() => setActiveFilterTab(activeFilterTab === "range" ? null : "range")}
            type="button"
          >
            <span className="filter-tab-label">{t("filter.range")}</span>
            <small className="filter-tab-value">{rangeSummary}</small>
          </button>
          <button
            className={`filter-tab${activeFilterTab === "providers" ? " active" : ""}`}
            onClick={() => setActiveFilterTab(activeFilterTab === "providers" ? null : "providers")}
            type="button"
          >
            <span className="filter-tab-label">{t("filter.providers")}</span>
            <small className="filter-tab-value">{providersSummary}</small>
            {selectedProviders.length ? <span className="filter-tab-tooltip">{selectedProviders.join("\n")}</span> : null}
          </button>
          <button
            className={`filter-tab${activeFilterTab === "models" ? " active" : ""}`}
            onClick={() => setActiveFilterTab(activeFilterTab === "models" ? null : "models")}
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
                <DropdownSelect<TimezoneMode>
                  dropUp
                  value={timezone}
                  onChange={setTimezone}
                  options={[
                    { value: "local", label: t("range.timezone.local") },
                    { value: "utc", label: t("range.timezone.utc") },
                  ]}
                />
              </label>
            </div>
            {customRangeError ? <p className="filter-error">{customRangeError}</p> : null}
          </div>
        </div>
      ) : null}

      {activeFilterTab === "providers" ? (
        <SelectOverlay
          label={t("filter.providers")}
          options={providers}
          search={providerSearch}
          selected={selectedProviders}
          onClose={() => setActiveFilterTab(null)}
          onClear={onClearProviders}
          onSearchChange={setProviderSearch}
          onToggle={onToggleProvider}
        />
      ) : null}

      {activeFilterTab === "models" ? (
        <SelectOverlay
          label={t("filter.models")}
          options={models}
          search={modelSearch}
          selected={selectedModels}
          onClose={() => setActiveFilterTab(null)}
          onClear={onClearModels}
          onSearchChange={setModelSearch}
          onToggle={onToggleModel}
        />
      ) : null}
    </>
  )
}
