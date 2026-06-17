import type { DashboardData } from "../../shared/metrics.js"
import type { ThemeSource } from "../../shared/theme.js"
import { t, type Locale } from "../i18n.js"
import { formatNumber } from "../utils.js"

export interface SettingsModalProps {
  dashboard: DashboardData | null
  isInstalling: boolean
  locale: Locale
  themeSource: ThemeSource
  onInstall: () => void
  onLocaleChange: (locale: Locale) => void
  onThemeSourceChange: (source: ThemeSource) => void
  onClose: () => void
}

export function SettingsModal({
  dashboard,
  isInstalling,
  locale,
  themeSource,
  onInstall,
  onLocaleChange,
  onThemeSourceChange,
  onClose,
}: SettingsModalProps) {
  return (
    <div className="range-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="range-modal-header">
          <strong>{t("settings.title")}</strong>
          <button className="range-close" onClick={onClose} type="button">×</button>
        </div>
        <span className={dashboard?.pluginInstalled ? "status-pill installed" : "status-pill"}>
          {dashboard?.pluginInstalled ? t("settings.pluginInstalled") : t("settings.pluginNotInstalled")}
        </span>
        <button className="primary-button settings-install" disabled={isInstalling} onClick={onInstall} type="button">
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
            <button className={locale === "en" ? "active" : ""} onClick={() => onLocaleChange("en")} type="button">{t("settings.language.en")}</button>
            <button className={locale === "zh" ? "active" : ""} onClick={() => onLocaleChange("zh")} type="button">{t("settings.language.zh")}</button>
          </div>
        </div>
        <div className="settings-language">
          <dt>{t("settings.theme")}</dt>
          <div className="lang-buttons">
            <button className={themeSource === "dark" ? "active" : ""} onClick={() => onThemeSourceChange("dark")} type="button">{t("settings.theme.dark")}</button>
            <button className={themeSource === "light" ? "active" : ""} onClick={() => onThemeSourceChange("light")} type="button">{t("settings.theme.light")}</button>
            <button className={themeSource === "system" ? "active" : ""} onClick={() => onThemeSourceChange("system")} type="button">{t("settings.theme.system")}</button>
          </div>
        </div>
        <p className="restart-hint">{t("settings.restartHint")}</p>
      </div>
    </div>
  )
}
