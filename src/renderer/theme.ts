import type { ResolvedTheme, ThemeSource } from "../shared/theme.js"

export const THEME_STORAGE_KEY = "theme"
export const DEFAULT_THEME_SOURCE: ThemeSource = "system"

const VALID_SOURCES: ReadonlySet<ThemeSource> = new Set(["system", "dark", "light"])

export function resolveTheme(source: ThemeSource, systemDark: boolean): ResolvedTheme {
  if (source === "dark" || source === "light") return source
  return systemDark ? "dark" : "light"
}

export function getSystemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true
}

export function getThemeSource(): ThemeSource {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored && VALID_SOURCES.has(stored as ThemeSource) ? (stored as ThemeSource) : DEFAULT_THEME_SOURCE
  } catch {
    return DEFAULT_THEME_SOURCE
  }
}

export function setThemeSource(source: ThemeSource): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, source)
  } catch {
    // localStorage 写入失败时静默忽略，下次启动回到默认
  }
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved)
}

export function subscribeSystemTheme(callback: (systemDark: boolean) => void): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
  if (!mq) return () => {}

  const listener = (event: MediaQueryListEvent) => callback(event.matches)
  mq.addEventListener("change", listener)
  return () => mq.removeEventListener("change", listener)
}
