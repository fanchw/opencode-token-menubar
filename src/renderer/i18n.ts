import en from "./locales/en.json" with { type: "json" }
import zh from "./locales/zh.json" with { type: "json" }

export type Locale = "en" | "zh"

const dictionaries: Record<Locale, Record<string, string>> = {
  en,
  zh,
}

let currentLocale: Locale = (localStorage.getItem("locale") as Locale) ?? "en"

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
  localStorage.setItem("locale", locale)
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] ?? dictionaries.en
  let text = dict[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v))
    }
  }
  return text
}
