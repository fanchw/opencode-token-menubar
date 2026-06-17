# Light Theme Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为菜单栏 app 增加完整浅色主题适配，修复浅色模式下滚动条白底灰条与首帧白闪问题。

**Architecture:** 渲染层 localStorage 驱动偏好 → `<html data-theme>` 属性切换 CSS 变量集 → IPC 单向同步主进程 `nativeTheme.themeSource` 让原生 UI（滚动条/窗口背景）跟随。CSS 全量变量化，`:root` 默认暗色，`[data-theme="light"]` 覆盖浅色。

**Tech Stack:** Electron 35+ / React 19 / TypeScript / Vite / Vitest。无新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-17-light-theme-adaptation-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/shared/theme.ts` | 新建 | `ThemeSource` 类型（跨进程共享） |
| `src/renderer/theme.ts` | 新建 | 偏好读写 + resolveTheme + applyTheme + subscribeSystemTheme |
| `src/renderer/theme.test.ts` | 新建 | 纯函数 + 异常 fallback 单测 |
| `src/shared/metrics.ts` | 修改 | `TokenMetricsApi` 加 `setThemeSource` 方法 |
| `src/main/main.ts` | 修改 | 加 `theme:set-source` IPC handler，导入 `nativeTheme` |
| `src/main/preload.ts` | 修改 | 暴露 `setThemeSource` |
| `src/renderer/App.tsx` | 修改 | `useState<ThemeSource>` + `useEffect` 集成 |
| `src/renderer/components/SettingsModal.tsx` | 修改 | 新增 `settings-theme` 段（三按钮） |
| `src/renderer/locales/en.json` | 修改 | 加 4 个 i18n key |
| `src/renderer/locales/zh.json` | 修改 | 加 4 个 i18n key |
| `src/renderer/styles.css` | 修改 | 全量变量化 + `[data-theme="light"]` 覆盖 + 滚动条 |
| `index.html` | 修改 | 加 `<meta name="color-scheme">` |

---

## Task 1: 创建共享 ThemeSource 类型与纯函数 resolveTheme（TDD）

**Files:**
- Create: `src/shared/theme.ts`
- Create: `src/renderer/theme.ts`
- Create: `src/renderer/theme.test.ts`

- [ ] **Step 1.1: 写失败测试（resolveTheme 全组合）**

创建 `src/renderer/theme.test.ts`：

```typescript
import { afterEach, describe, expect, test, vi } from "vitest"

import { resolveTheme, getThemeSource, setThemeSource, THEME_STORAGE_KEY } from "./theme.js"

describe("resolveTheme", () => {
  test("显式偏好 dark 时无视系统", () => {
    expect(resolveTheme("dark", true)).toBe("dark")
    expect(resolveTheme("dark", false)).toBe("dark")
  })

  test("显式偏好 light 时无视系统", () => {
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("light", false)).toBe("light")
  })

  test("偏好 system 时跟随系统", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })
})

describe("getThemeSource / setThemeSource", () => {
  afterEach(() => {
    localStorage.clear()
  })

  test("默认返回 system", () => {
    expect(getThemeSource()).toBe("system")
  })

  test("setThemeSource 持久化到 localStorage", () => {
    setThemeSource("dark")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
    expect(getThemeSource()).toBe("dark")
  })

  test("localStorage 异常时回退 system", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(getThemeSource()).toBe("system")
    vi.restoreAllMocks()
  })

  test("脏数据回退 system", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon")
    expect(getThemeSource()).toBe("system")
  })
})
```

- [ ] **Step 1.2: 运行测试验证失败**

Run: `bun run test -- src/renderer/theme.test.ts`
Expected: FAIL，错误 `Failed to resolve import "./theme.js"`

- [ ] **Step 1.3: 创建 `src/shared/theme.ts`**

```typescript
export type ThemeSource = "system" | "dark" | "light"

export type ResolvedTheme = "dark" | "light"
```

- [ ] **Step 1.4: 创建 `src/renderer/theme.ts` 完整实现**

```typescript
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
```

- [ ] **Step 1.5: 运行测试验证通过**

Run: `bun run test -- src/renderer/theme.test.ts`
Expected: PASS（全部 7 个 test）

- [ ] **Step 1.6: 提交**

```bash
git add src/shared/theme.ts src/renderer/theme.ts src/renderer/theme.test.ts
git commit -m "feat: 新增主题偏好纯函数与 resolveTheme 单测"
```

---

## Task 2: 扩展 TokenMetricsApi 类型加 setThemeSource

**Files:**
- Modify: `src/shared/metrics.ts:131-145`

- [ ] **Step 2.1: 导入 ThemeSource 并扩展接口**

在 `src/shared/metrics.ts` 顶部新增导入（紧邻现有 imports，约第 1 行附近，按字母序插入）：

```typescript
import type { ThemeSource } from "./theme.js"
```

修改 `TokenMetricsApi` 接口（在 `onDashboardUpdated` 之后、`}` 之前插入一行）：

```typescript
export interface TokenMetricsApi {
  getDashboardData(filters: DashboardFilters): Promise<DashboardData>;
  getSummary(filters: DashboardFilters): Promise<SummaryResponse>;
  getRecent(filters: DashboardFilters): Promise<RecentResponse>;
  getRanking(filters: DashboardFilters): Promise<ModelRankingRow[]>;
  getTrends(filters: DashboardFilters): Promise<TrendsResponse>;
  installPlugin(): Promise<{ installed: true; targetPath: string }>;
  onDashboardUpdated(callback: (payload: DashboardUpdatePayload) => void): () => void;
  setThemeSource(source: ThemeSource): Promise<void>;
}
```

- [ ] **Step 2.2: 类型检查**

Run: `bun run build`
Expected: 编译失败，错误指向 `src/main/preload.ts`（`tokenMetrics` 对象缺 `setThemeSource` 方法）—— 这是预期的，下一任务补齐。**仅记录错误，本任务不 commit**。

---

## Task 3: 主进程 IPC handler 与 preload 暴露

**Files:**
- Modify: `src/main/main.ts:1`（导入 nativeTheme）+ 在 ipcMain 区块新增 handler
- Modify: `src/main/preload.ts`

- [ ] **Step 3.1: 修改 `src/main/main.ts` 导入 nativeTheme**

把第 1 行的 electron 导入改为包含 `nativeTheme`：

```typescript
import { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray } from "electron"
```

- [ ] **Step 3.2: 在 ipcMain 区块新增 handler**

定位 `src/main/main.ts` 中已有的 `ipcMain.handle("metrics:get-dashboard-data", ...)` 区块（约 434 行）。在所有 metrics handler 注册**之后**、`createWindow()` 调用**之前**（约 453 行附近）插入：

```typescript
ipcMain.handle("theme:set-source", (_event, source: unknown) => {
  if (source === "dark" || source === "light" || source === "system") {
    nativeTheme.themeSource = source
  }
})
```

- [ ] **Step 3.3: 修改 `src/main/preload.ts`**

把 `tokenMetrics` 对象末尾加 `setThemeSource`：

```typescript
const tokenMetrics: TokenMetricsApi = {
  getDashboardData: (filters) => ipcRenderer.invoke("metrics:get-dashboard-data", filters),
  getSummary: (filters) => ipcRenderer.invoke("metrics:get-summary", filters),
  getRecent: (filters) => ipcRenderer.invoke("metrics:get-recent", filters),
  getRanking: (filters) => ipcRenderer.invoke("metrics:get-ranking", filters),
  getTrends: (filters) => ipcRenderer.invoke("metrics:get-trends", filters),
  installPlugin: () => ipcRenderer.invoke("plugin:install"),
  onDashboardUpdated: (callback) => {
    const listener = (_event: unknown, payload: { reason: "new-data" | "catalog-sync" }) => callback(payload)
    ipcRenderer.on("metrics:dashboard-updated", listener)

    return () => ipcRenderer.removeListener("metrics:dashboard-updated", listener)
  },
  setThemeSource: (source) => ipcRenderer.invoke("theme:set-source", source),
}
```

- [ ] **Step 3.4: 类型检查与构建**

Run: `bun run build`
Expected: PASS（preload 类型对齐 TokenMetricsApi，无错误）

- [ ] **Step 3.5: 提交**

```bash
git add src/shared/metrics.ts src/main/main.ts src/main/preload.ts
git commit -m "feat: 新增 theme:set-source IPC 与 nativeTheme 同步"
```

---

## Task 4: App.tsx 集成主题 hook

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 4.1: 导入主题模块**

修改 `src/renderer/App.tsx:6`（locale 导入行下方新增一行）：

```typescript
import { t, getLocale, setLocale, type Locale } from "./i18n.js"
import {
  applyTheme,
  getSystemDark,
  getThemeSource,
  resolveTheme,
  setThemeSource as persistThemeSource,
  subscribeSystemTheme,
} from "./theme.js"
import type { ThemeSource } from "../shared/theme.js"
```

- [ ] **Step 4.2: 新增主题 state**

在 `src/renderer/App.tsx:33`（locale useState 行下方）新增：

```typescript
const [locale, setLocaleState] = useState<Locale>(getLocale())
const [themeSource, setThemeSourceState] = useState<ThemeSource>(getThemeSource())
```

- [ ] **Step 4.3: 新增主题初始化与系统订阅 useEffect**

在 `src/renderer/App.tsx` 的 `activeFilterTab` body overflow useEffect（约 238 行）**之后**新增：

```typescript
useEffect(() => {
  const resolved = resolveTheme(themeSource, getSystemDark())
  applyTheme(resolved)
  void window.tokenMetrics.setThemeSource(themeSource)
}, [themeSource])

useEffect(() => {
  const unsubscribe = subscribeSystemTheme((systemDark) => {
    if (getThemeSource() === "system") {
      applyTheme(resolveTheme("system", systemDark))
    }
  })
  return unsubscribe
}, [])
```

- [ ] **Step 4.4: 新增 changeThemeSource 处理函数**

在 `src/renderer/App.tsx` 的 `changeLocale` 函数（约 184 行）**之后**新增：

```typescript
function changeLocale(next: Locale) {
  setLocale(next)
  setLocaleState(next)
}

function changeThemeSource(next: ThemeSource) {
  persistThemeSource(next)
  setThemeSourceState(next)
}
```

- [ ] **Step 4.5: 把 changeThemeSource 传给 SettingsModal**

修改 `src/renderer/App.tsx` 中 `<SettingsModal>` 调用（约 384 行），新增两个 props：

```typescript
<SettingsModal
  dashboard={dashboard}
  isInstalling={isInstalling}
  locale={locale}
  themeSource={themeSource}
  onInstall={handleInstallPlugin}
  onLocaleChange={changeLocale}
  onThemeSourceChange={changeThemeSource}
  onClose={() => setSettingsOpen(false)}
/>
```

- [ ] **Step 4.6: 类型检查**

Run: `bun run build`
Expected: 编译失败，错误指向 `SettingsModal` props 不匹配（缺 `themeSource` / `onThemeSourceChange`）—— 这是预期的，下一任务补齐。**仅记录错误，本任务不 commit**。

---

## Task 5: SettingsModal 主题切换 UI + i18n keys

**Files:**
- Modify: `src/renderer/locales/en.json`
- Modify: `src/renderer/locales/zh.json`
- Modify: `src/renderer/components/SettingsModal.tsx`

- [ ] **Step 5.1: en.json 新增 4 个 key**

修改 `src/renderer/locales/en.json`。在 `"settings.language.zh": "简体中文"` 行**之后**（约 86 行）新增：

```json
  "settings.language.zh": "简体中文",
  "settings.theme": "Theme",
  "settings.theme.dark": "Dark",
  "settings.theme.light": "Light",
  "settings.theme.system": "System",
```

- [ ] **Step 5.2: zh.json 新增 4 个 key**

修改 `src/renderer/locales/zh.json`。在 `"settings.language.zh": "简体中文"` 行**之后**（约 86 行）新增：

```json
  "settings.language.zh": "简体中文",
  "settings.theme": "主题",
  "settings.theme.dark": "暗色",
  "settings.theme.light": "浅色",
  "settings.theme.system": "跟随系统",
```

- [ ] **Step 5.3: 扩展 SettingsModalProps 与组件**

修改 `src/renderer/components/SettingsModal.tsx` 完整替换为：

```typescript
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
```

- [ ] **Step 5.4: 类型检查与构建**

Run: `bun run build`
Expected: PASS

- [ ] **Step 5.5: 手动验证（在 dev 模式）**

启动 dev：
- 终端 1: `bun run dev`
- 终端 2: `bun run dev:app`

打开 app → 点击设置图标 → 点击 Dark / Light / System 三按钮：
- `<html>` 标签 `data-theme` 属性应在 `dark` / `light` 之间切换（DevTools 验证）
- 但**此时页面视觉不应有变化**（因为 styles.css 还未变量化，Task 6-8 处理）
- 重启 app，localStorage 中的偏好应保留

- [ ] **Step 5.6: 提交**

```bash
git add src/renderer/locales/en.json src/renderer/locales/zh.json src/renderer/components/SettingsModal.tsx src/renderer/App.tsx
git commit -m "feat: 设置面板新增主题切换开关与 i18n"
```

---

## Task 6: styles.css 变量化（一）— `:root` 暗色变量提取 + `color-scheme`

**Files:**
- Modify: `src/renderer/styles.css:1-18`（:root 块替换）

此任务**不**移除选择器中的硬编码（避免破坏视觉）。仅在 `:root` 添加完整变量集 + `color-scheme` 声明。视觉应零变化。

- [ ] **Step 6.1: 替换 `:root` 块**

把 `src/renderer/styles.css:1-18` 的现有 `:root { ... }` 完整替换为：

```css
:root {
  /* 背景层 */
  --bg-base: #0a0410;
  --bg-panel-solid: #0d0820;
  --bg-panel: rgba(15, 8, 30, 0.55);
  --bg-panel-soft: rgba(15, 8, 30, 0.4);
  --bg-overlay: rgba(0, 0, 0, 0.6);
  --bg-grid: rgba(0, 240, 255, 0.035);

  /* 文字层 */
  --text-primary: #e0e0f0;
  --text-muted: #6b6b8d;
  --text-dim: #4a4a6a;

  /* 强调（霓虹） */
  --neon-cyan: #00f0ff;
  --neon-pink: #ff2e97;
  --neon-purple: #b026ff;

  /* Glow */
  --glow-cyan: 0 0 12px rgba(0, 240, 255, 0.15);
  --glow-pink: 0 0 12px rgba(255, 46, 151, 0.15);

  /* 交互表面 */
  --surface-button: rgba(20, 10, 35, 0.5);
  --surface-input: rgba(20, 10, 35, 0.4);
  --surface-input-strong: rgba(20, 10, 35, 0.6);
  --surface-elevated: rgba(30, 22, 50, 0.95);

  /* Hover 半透明青 */
  --hover-soft: rgba(0, 240, 255, 0.04);
  --hover-medium: rgba(0, 240, 255, 0.06);
  --hover-strong: rgba(0, 240, 255, 0.08);
  --hover-chip: rgba(0, 240, 255, 0.1);
  --hover-close: rgba(0, 240, 255, 0.12);

  /* 边界 */
  --divider: rgba(75, 75, 110, 0.1);
  --divider-strong: rgba(75, 75, 110, 0.25);
  --divider-cyan: rgba(0, 240, 255, 0.12);
  --divider-cyan-soft: rgba(0, 240, 255, 0.03);

  /* 边框 focus */
  --border-cyan-soft: rgba(0, 240, 255, 0.28);
  --border-cyan-strong: rgba(0, 240, 255, 0.8);
  --border-input: rgba(100, 116, 139, 0.38);
  --border-input-focus: rgba(0, 240, 255, 0.6);

  /* 状态色 */
  --status-error-text: #fca5a5;
  --status-error-bg: rgba(69, 10, 10, 0.4);
  --status-warning-text: #fde68a;
  --status-warning-bg: rgba(120, 53, 15, 0.18);
  --status-warning-border: rgba(251, 191, 36, 0.42);
  --status-success-text: #bbf7d0;
  --status-success-bg: rgba(20, 83, 45, 0.2);
  --status-success-border: rgba(34, 197, 94, 0.42);
  --status-missing-text: #fbbf24;

  /* rank card 文字（强色） */
  --rank-gold-strong: #fef3c7;
  --rank-silver-strong: #f1f5f9;
  --rank-bronze-strong: #fde68a;

  /* 浮层渐变线 */
  --panel-top-gradient: linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.3), rgba(255, 46, 151, 0.2), transparent);

  /* text-shadow 微光 */
  --text-shadow-cyan-soft: 0 0 6px rgba(0, 240, 255, 0.25);
  --text-shadow-cyan-medium: 0 0 8px rgba(0, 240, 255, 0.15);
  --text-shadow-cyan-strong: 0 0 8px rgba(0, 240, 255, 0.2);

  /* shadow */
  --shadow-panel-inset: 0 1px 0 rgba(255, 255, 255, 0.03) inset;
  --shadow-modal: 0 0 40px rgba(0, 240, 255, 0.08), 0 24px 60px rgba(0, 0, 0, 0.6);
  --shadow-tooltip: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-dropdown: 0 8px 20px rgba(0, 0, 0, 0.5);
  --shadow-range-modal-tooltip: 0 10px 24px rgba(0, 0, 0, 0.5);

  /* 兼容现有直接颜色属性（保留） */
  color: var(--text-primary);
  background: var(--bg-base);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  color-scheme: dark;
}
```

- [ ] **Step 6.2: 构建验证**

Run: `bun run build`
Expected: PASS（仅新增变量定义，未引用，不影响现有选择器）

- [ ] **Step 6.3: 手动验证（视觉零变化）**

启动 dev：`bun run dev` + `bun run dev:app`
Expected: 视觉与改动前完全一致（变量定义未引用）

- [ ] **Step 6.4: 提交**

```bash
git add src/renderer/styles.css
git commit -m "refactor: 提取暗色主题变量到 :root 并声明 color-scheme"
```

---

## Task 7: styles.css 变量化（二）— 选择器引用替换

**Files:**
- Modify: `src/renderer/styles.css`（除 :root 外的所有选择器）

此任务把所有选择器中的硬编码颜色替换为 `var(--*)` 引用。**保留中立色**（图表数据色 / rank badge 金银铜 / react-day-picker `--rdp-*`）。

**替换规则**：精确字符串替换。每条规则左侧为现值，右侧为目标。

- [ ] **Step 7.1: 背景层替换**

按以下映射在 `src/renderer/styles.css` 全文替换（使用编辑器的「全部替换」功能，区分大小写、精确匹配）。注意仅在颜色值出现处替换，不要触碰 :root 内的变量定义本身。

| 原值 | 替换为 |
|---|---|
| `linear-gradient(rgba(0, 240, 255, 0.035) 1px, transparent 1px),\n    linear-gradient(90deg, rgba(0, 240, 255, 0.035) 1px, transparent 1px),\n    #0a0410` | `linear-gradient(var(--bg-grid) 1px, transparent 1px),\n    linear-gradient(90deg, var(--bg-grid) 1px, transparent 1px),\n    var(--bg-base)` |
| `background: #0d0820` | `background: var(--bg-panel-solid)` |

注：第二处 `#0d0820` 出现在 `.settings-modal`、`.dropdown-menu`、`.range-modal`、`.select-modal`、`.filter-tab-tooltip` 五处，全部替换为 `var(--bg-panel-solid)`。

- [ ] **Step 7.2: 文字层替换**

| 原值 | 替换为 |
|---|---|
| `color: #e0e0f0` | `color: var(--text-primary)` |
| `color: #6b6b8d` | `color: var(--text-muted)` |
| `color: #4a4a6a` | `color: var(--text-dim)` |
| `color: #8a8aad` | `color: var(--text-muted)` |

注：`#e0e0f0` 出现约 15+ 处（h2、stat-value、page-info、req-col-model 等），全部替换。

- [ ] **Step 7.3: 强调色（霓虹）替换**

| 原值 | 替换为 |
|---|---|
| `color: #00f0ff` | `color: var(--neon-cyan)` |

注：`#00f0ff` 出现约 10 处（eyebrow、stat-label、dropdown-arrow、dropdown-check、filter-tab-label、chip.active、primary-button 等）。全部替换。

`#ff2e97` 与 `#b026ff` 仅出现在 h1 渐变与 panel::before 渐变，用以下处理：

`.app-header h1` 的 background 渐变改为：
```css
background: linear-gradient(135deg, var(--neon-cyan) 0%, var(--neon-purple) 55%, var(--neon-pink) 100%);
```

`.panel::before` 的 background 改为：
```css
background: var(--panel-top-gradient);
```

- [ ] **Step 7.4: 交互表面与 hover 替换**

| 原值 | 替换为 |
|---|---|
| `background: rgba(20, 10, 35, 0.5)` | `background: var(--surface-button)` |
| `background: rgba(20, 10, 35, 0.4)` | `background: var(--surface-input)` |
| `background: rgba(20, 10, 35, 0.6)` | `background: var(--surface-input-strong)` |
| `background: rgba(30, 22, 50, 0.95)` | `background: var(--surface-elevated)` |
| `background: rgba(0, 240, 255, 0.04)` | `background: var(--hover-soft)` |
| `background: rgba(0, 240, 255, 0.06)` | `background: var(--hover-medium)` |
| `background: rgba(0, 240, 255, 0.08)` | `background: var(--hover-strong)` |
| `background: rgba(0, 240, 255, 0.1)` | `background: var(--hover-chip)` |
| `background: rgba(0, 240, 255, 0.12)` | `background: var(--hover-close)` |
| `background: rgba(15, 8, 30, 0.4)` | `background: var(--bg-panel-soft)` |
| `background: rgba(15, 8, 30, 0.55)` | `background: var(--bg-panel)` |
| `background: rgba(0, 0, 0, 0.6)` | `background: var(--bg-overlay)` |

注：rgba 半透明值可能在多处出现，全部按映射替换。

- [ ] **Step 7.5: 边界与边框替换**

| 原值 | 替换为 |
|---|---|
| `border-bottom: 1px solid rgba(75, 75, 110, 0.25)` | `border-bottom: 1px solid var(--divider-strong)` |
| `border-bottom: 1px solid rgba(75, 75, 110, 0.1)` | `border-bottom: 1px solid var(--divider)` |
| `border-bottom: 1px solid rgba(0, 240, 255, 0.12)` | `border-bottom: 1px solid var(--divider-cyan)` |
| `border-bottom: 1px solid rgba(0, 240, 255, 0.1)` | `border-bottom: 1px solid var(--divider-cyan)` |
| `border: 1px solid rgba(0, 240, 255, 0.22)` | `border: 1px solid var(--border-cyan-soft)` |
| `border: 1px solid rgba(0, 240, 255, 0.28)` | `border: 1px solid var(--border-cyan-soft)` |
| `border: 1px solid rgba(100, 116, 139, 0.38)` | `border: 1px solid var(--border-input)` |
| `border-color: rgba(0, 240, 255, 0.6)` | `border-color: var(--border-input-focus)` |
| `border-color: rgba(0, 240, 255, 0.8)` | `border-color: var(--border-cyan-strong)` |
| `box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset` | `box-shadow: var(--shadow-panel-inset)` |

- [ ] **Step 7.6: text-shadow 替换**

| 原值 | 替换为 |
|---|---|
| `text-shadow: 0 0 6px rgba(0, 240, 255, 0.25)` | `text-shadow: var(--text-shadow-cyan-soft)` |
| `text-shadow: 0 0 8px rgba(0, 240, 255, 0.15)` | `text-shadow: var(--text-shadow-cyan-medium)` |
| `text-shadow: 0 0 8px rgba(0, 240, 255, 0.2)` | `text-shadow: var(--text-shadow-cyan-strong)` |

- [ ] **Step 7.7: shadow 替换**

| 原值 | 替换为 |
|---|---|
| `box-shadow: 0 0 40px rgba(0, 240, 255, 0.08), 0 24px 60px rgba(0, 0, 0, 0.6)` | `box-shadow: var(--shadow-modal)` |
| `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5)` | `box-shadow: var(--shadow-tooltip)` |
| `box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5)` | `box-shadow: var(--shadow-dropdown)` |
| `box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5)` | `box-shadow: var(--shadow-range-modal-tooltip)` |

- [ ] **Step 7.8: 状态色替换（status-pill / notice.error / select-item.missing）**

| 原值 | 替换为 |
|---|---|
| `color: #fca5a5` | `color: var(--status-error-text)` |
| `background: rgba(69, 10, 10, 0.4)` | `background: var(--status-error-bg)` |
| `color: #fde68a` | `color: var(--status-warning-text)` |
| `background: rgba(120, 53, 15, 0.18)` | `background: var(--status-warning-bg)` |
| `border: 1px solid rgba(251, 191, 36, 0.42)` | `border: 1px solid var(--status-warning-border)` |
| `color: #bbf7d0` | `color: var(--status-success-text)` |
| `background: rgba(20, 83, 45, 0.2)` | `background: var(--status-success-bg)` |
| `border-color: rgba(34, 197, 94, 0.42)` | `border-color: var(--status-success-border)` |
| `color: #fbbf24` | `color: var(--status-missing-text)` |

注：`#fbbf24` 出现两处（`.select-item.missing` color + `.select-item.missing .select-item-meta` color），全部替换。

- [ ] **Step 7.9: rank card strong 文字色替换**

| 原值 | 替换为 |
|---|---|
| `.rank-1 .rank-card-header strong { color: #fef3c7 }` 中 `#fef3c7` | `var(--rank-gold-strong)` |
| `.rank-2 .rank-card-header strong { color: #f1f5f9 }` 中 `#f1f5f9` | `var(--rank-silver-strong)` |
| `.rank-3 .rank-card-header strong { color: #fde68a }` 中 `#fde68a` | `var(--rank-bronze-strong)` |

注：`.rank-1/2/3` 选择器的 `background: linear-gradient(...)` 中 `rgba(15, 8, 30, 0.5)` 锚点替换为 `var(--bg-panel-soft)`，但金银铜的彩色 rgba（如 `rgba(250, 204, 21, 0.1)`）**保留不变**（rank badge 中立色）。

- [ ] **Step 7.10: 构建验证**

Run: `bun run build`
Expected: PASS

- [ ] **Step 7.11: 手动验证（暗色视觉零变化）**

启动 dev：`bun run dev` + `bun run dev:app`
Expected: 暗色模式视觉与改动前完全一致。在 DevTools Elements 面板检查任意选择器（如 `.icon-button`），其 background 应显示为 `var(--surface-button)` 解析值 `rgba(20, 10, 35, 0.5)`。

- [ ] **Step 7.12: 提交**

```bash
git add src/renderer/styles.css
git commit -m "refactor: 选择器引用主题变量完成暗色变量化"
```

---

## Task 8: styles.css 变量化（三）— `[data-theme="light"]` 覆盖块

**Files:**
- Modify: `src/renderer/styles.css`（在 :root 块结束后插入）

- [ ] **Step 8.1: 在 :root 块之后插入 `[data-theme="light"]` 覆盖块**

在 `src/renderer/styles.css` 的 `:root { ... }` 块结束后（`}` 之后、`*, *::before, *::after {` 之前）插入：

```css
[data-theme="light"] {
  /* 背景层 */
  --bg-base: #f5f0fa;
  --bg-panel-solid: #ffffff;
  --bg-panel: rgba(255, 255, 255, 0.72);
  --bg-panel-soft: rgba(255, 255, 255, 0.6);
  --bg-overlay: rgba(40, 30, 60, 0.45);
  --bg-grid: rgba(176, 38, 255, 0.04);

  /* 文字层 */
  --text-primary: #2a2540;
  --text-muted: #6b6584;
  --text-dim: #9c97b3;

  /* 强调（霓虹）—— 文字场景降饱和度到 Tailwind 600 级 */
  --neon-cyan: #0891b2;
  --neon-pink: #db2777;
  --neon-purple: #9333ea;

  /* Glow */
  --glow-cyan: 0 0 12px rgba(8, 145, 178, 0.25);
  --glow-pink: 0 0 12px rgba(219, 39, 119, 0.20);

  /* 交互表面 */
  --surface-button: rgba(245, 240, 250, 0.8);
  --surface-input: rgba(236, 228, 245, 0.6);
  --surface-input-strong: rgba(236, 228, 245, 0.8);
  --surface-elevated: rgba(236, 228, 245, 0.95);

  /* Hover */
  --hover-soft: rgba(8, 145, 178, 0.06);
  --hover-medium: rgba(8, 145, 178, 0.08);
  --hover-strong: rgba(8, 145, 178, 0.1);
  --hover-chip: rgba(8, 145, 178, 0.12);
  --hover-close: rgba(8, 145, 178, 0.15);

  /* 边界 */
  --divider: rgba(75, 65, 110, 0.1);
  --divider-strong: rgba(75, 65, 110, 0.18);
  --divider-cyan: rgba(8, 145, 178, 0.2);
  --divider-cyan-soft: rgba(8, 145, 178, 0.05);

  /* 边框 */
  --border-cyan-soft: rgba(8, 145, 178, 0.3);
  --border-cyan-strong: rgba(8, 145, 178, 0.7);
  --border-input: rgba(100, 116, 139, 0.42);
  --border-input-focus: rgba(8, 145, 178, 0.6);

  /* 状态色 */
  --status-error-text: #b91c1c;
  --status-error-bg: rgba(254, 226, 226, 0.6);
  --status-warning-text: #b45309;
  --status-warning-bg: rgba(254, 243, 199, 0.7);
  --status-warning-border: rgba(180, 83, 9, 0.4);
  --status-success-text: #15803d;
  --status-success-bg: rgba(220, 252, 231, 0.7);
  --status-success-border: rgba(21, 128, 61, 0.42);
  --status-missing-text: #b45309;

  /* rank card 文字色（深档） */
  --rank-gold-strong: #78350f;
  --rank-silver-strong: #334155;
  --rank-bronze-strong: #92400e;

  /* 浮层渐变线 */
  --panel-top-gradient: linear-gradient(90deg, transparent, rgba(8, 145, 178, 0.3), rgba(219, 39, 119, 0.2), transparent);

  /* text-shadow */
  --text-shadow-cyan-soft: 0 0 6px rgba(8, 145, 178, 0.18);
  --text-shadow-cyan-medium: 0 0 8px rgba(8, 145, 178, 0.12);
  --text-shadow-cyan-strong: 0 0 8px rgba(8, 145, 178, 0.18);

  /* shadow */
  --shadow-panel-inset: 0 1px 0 rgba(0, 0, 0, 0.04) inset;
  --shadow-modal: 0 0 40px rgba(8, 145, 178, 0.08), 0 24px 60px rgba(40, 30, 60, 0.18);
  --shadow-tooltip: 0 4px 12px rgba(40, 30, 60, 0.18);
  --shadow-dropdown: 0 8px 20px rgba(40, 30, 60, 0.2);
  --shadow-range-modal-tooltip: 0 10px 24px rgba(40, 30, 60, 0.22);

  color-scheme: light;
}
```

- [ ] **Step 8.2: 构建验证**

Run: `bun run build`
Expected: PASS

- [ ] **Step 8.3: 手动验证（浅色切换生效）**

启动 dev：`bun run dev` + `bun run dev:app`
打开 app → 设置 → 切到 Light：
- 整个 app 应变为浅紫白底 + 深紫灰文字 + 霓虹强调色降饱和
- DevTools 检查 `<html data-theme="light"`，且 `.app-shell` 背景应为 `#f5f0fa` 系列
- 切回 Dark，应回到原视觉

- [ ] **Step 8.4: 提交**

```bash
git add src/renderer/styles.css
git commit -m "feat: 新增 data-theme=light 浅色主题变量覆盖块"
```

---

## Task 9: ::-webkit-scrollbar 双套配色 + index.html color-scheme meta

**Files:**
- Modify: `src/renderer/styles.css`（在文件末尾追加滚动条样式）
- Modify: `index.html`

- [ ] **Step 9.1: styles.css 末尾追加滚动条样式**

在 `src/renderer/styles.css` 文件**末尾**追加：

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 240, 255, 0.2);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 240, 255, 0.35);
}

[data-theme="light"] ::-webkit-scrollbar-thumb {
  background: rgba(176, 38, 255, 0.25);
}

[data-theme="light"] ::-webkit-scrollbar-thumb:hover {
  background: rgba(176, 38, 255, 0.4);
}
```

- [ ] **Step 9.2: index.html 加 color-scheme meta**

修改 `index.html`，在 `<meta name="viewport" ...>` 行**之后**插入：

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>OpenCode Token Menubar</title>
```

- [ ] **Step 9.3: 构建验证**

Run: `bun run build`
Expected: PASS

- [ ] **Step 9.4: 手动验证（滚动条与首帧）**

启动 dev：`bun run dev` + `bun run dev:app`

1. **滚动条**：在 `.settings-modal` / `.range-modal` / `.select-list` 触发滚动，暗色模式下滚动条 thumb 应为淡青色；切到 Light 应为淡紫色
2. **首帧**：重启 app，观察窗口出现瞬间应**无白底闪烁**（nativeTheme.themeSource 默认 system，跟系统主题）

- [ ] **Step 9.5: 提交**

```bash
git add src/renderer/styles.css index.html
git commit -m "feat: 自定义滚动条双套配色与 color-scheme meta 声明"
```

---

## Task 10: 最终集成验证

**Files:** 无修改（仅验证）

- [ ] **Step 10.1: 运行所有测试**

Run: `bun run test`
Expected: PASS（含 `src/renderer/theme.test.ts` 全部 7 个 test，及既有测试不破）

- [ ] **Step 10.2: 构建**

Run: `bun run build`
Expected: PASS，无类型错误、无 Vite 警告

- [ ] **Step 10.3: 端到端手动验证清单**

启动 dev：`bun run dev` + `bun run dev:app`，逐项验证：

| 验证项 | 期望 |
|---|---|
| 默认首次打开（无 localStorage） | `<html data-theme="dark"`（若系统暗）或 `"light"`（若系统亮），视觉与系统一致 |
| 设置 → 切 Dark | 立即暗色，`<html data-theme="dark"`，重启后保持 |
| 设置 → 切 Light | 立即浅色（蒸汽波浅紫白底），`<html data-theme="light"`，重启后保持 |
| 设置 → 切 System | 跟随系统；切换 macOS 系统外观时 app 实时跟随（无需重启） |
| 滚动条 | 暗色模式 thumb 淡青；浅色模式 thumb 淡紫；非破坏性 |
| 排名榜前三 | 金银铜 badge 在两套主题下都清晰可辨 |
| 图表 | Cache 绿 / Fresh 灰 / Output 蓝在两套主题下都不变 |
| 状态色 | success/warning/error 三态 pill 在浅色下文字更深、底色更浅 |
| 设置面板语言切换 | 中英文 i18n 在两套主题下都正常 |
| DevTools 改 `<html data-theme>` | 手动改属性即时切换主题，可作调试 |
| 首帧白闪 | 重启 app，窗口出现无白底闪烁 |

- [ ] **Step 10.4: 视觉问题修复（如有）**

若 rank card 浅色版金银铜精致感不足，或某处对比度低，按需微调 `[data-theme="light"]` 内的对应变量值（spec 标注此为「实现后视觉验收」迭代点）。修复后：

```bash
git add src/renderer/styles.css
git commit -m "style: 浅色主题视觉调优"
```

---

## Self-Review Summary

**Spec coverage**:
- 架构（localStorage + IPC + nativeTheme）→ Task 1-5
- CSS 全量变量化 → Task 6-7
- `[data-theme="light"]` 浅色覆盖 → Task 8
- 滚动条双保险 → Task 9
- BrowserWindow 白闪 → Task 9 (color-scheme meta) + Task 3 (nativeTheme.themeSource)
- 组件改动（SettingsModal / App / preload / main / i18n）→ Task 3-5
- 测试（resolveTheme 纯函数 + fallback）→ Task 1
- 中立色保留（图表 / rank badge）→ Task 7 替换规则明确排除
- 错误处理（localStorage 异常 / matchMedia 不支持）→ Task 1 实现已含
- tray icon 无需改动 → spec 已确认，本 plan 不涉及

**Type consistency**: `ThemeSource` 在 `src/shared/theme.ts` 定义，被 `metrics.ts` / `preload.ts` / `App.tsx` / `SettingsModal.tsx` 一致引用；`setThemeSource` 方法签名（`(source: ThemeSource) => Promise<void>`）在接口、preload、App 调用三处对齐。

**Placeholder scan**: 无 TBD / TODO / "适当处理" / "类似上面"。CSS 替换规则给出精确字符串映射，每条都可执行。
