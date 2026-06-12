# Menubar Live Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable macOS menubar dashboard with event-driven refresh, filterable analytics, timezone-aware display, compact token units, and a `Midnight Terminal` UI.

**Architecture:** Keep SQLite and Electron main as the data authority. Renderer owns filter state and sends query filters through preload IPC; main returns filtered dashboard data and broadcasts update notifications after writes. UI logic is split into small renderer helper modules for time ranges, formatting, and filter state so behavior can be tested without browser tests.

**Tech Stack:** Electron, React, TypeScript, Vitest, Recharts, node-sqlite3-wasm, chokidar.

---

## File Structure

- Modify `src/shared/metrics.ts` to add dashboard filter/query/result types and token formatting helper exports.
- Modify `src/shared/metrics.test.ts` to cover token unit formatting.
- Modify `src/main/metricsStore.ts` to accept filtered dashboard queries and return filter option metadata.
- Modify `src/main/metricsStore.test.ts` to cover time/provider/model filters and option metadata.
- Modify `src/main/preload.ts` to expose filtered fetch and dashboard update subscription APIs.
- Modify `src/main/main.ts` to broadcast update events, add tray context menu, and remove renderer polling dependency.
- Create `src/renderer/timeFilters.ts` for quick/custom time range resolution and timezone-aware labels.
- Create `src/renderer/timeFilters.test.ts` for range and timezone behavior.
- Modify `src/renderer/App.tsx` to own filters, subscribe to live updates, and render the new dashboard structure.
- Modify `src/renderer/styles.css` to implement the `Midnight Terminal` visual system.

---

## Task 1: Shared Query Types And Token Units

**Files:**
- Modify: `src/shared/metrics.ts`
- Modify: `src/shared/metrics.test.ts`

- [ ] **Step 1: Write failing token format tests**

Add this import and test block in `src/shared/metrics.test.ts`:

```ts
import { formatTokenUnit, normalizeMetricEvent } from "./metrics.js";

describe("formatTokenUnit", () => {
  test.each([
    [0, "0"],
    [987, "987"],
    [1_000, "1K"],
    [12_400, "12.4K"],
    [1_000_000, "1M"],
    [3_250_000, "3.3M"],
    [1_000_000_000, "1B"],
    [1_000_000_000_000, "1T"],
  ])("formats %i as %s", (value, expected) => {
    expect(formatTokenUnit(value)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `bun run test src/shared/metrics.test.ts`

Expected: FAIL because `formatTokenUnit` is not exported.

- [ ] **Step 3: Add shared types and formatter**

In `src/shared/metrics.ts`, add these interfaces near the dashboard types:

```ts
export interface DashboardFilters {
  start: string;
  end: string;
  providers?: string[];
  models?: string[];
}

export interface FilterOption {
  value: string;
  requestCount: number;
  totalTokens: number;
}
```

Extend `DashboardData`:

```ts
export interface DashboardData {
  today: TodaySummary;
  recent: MetricEvent[];
  modelRanking: ModelRankingRow[];
  hourlyTrends: HourlyTrendRow[];
  providers: FilterOption[];
  models: FilterOption[];
  importErrors?: number;
  pluginInstalled?: boolean;
  paths?: {
    jsonlPath: string;
    ingestPath: string;
    sqlitePath: string;
    pluginPath: string;
  };
}
```

Change `TokenMetricsApi`:

```ts
export interface TokenMetricsApi {
  getDashboardData(filters: DashboardFilters): Promise<DashboardData>;
  installPlugin(): Promise<{ installed: true; targetPath: string }>;
  onDashboardUpdated(callback: () => void): () => void;
}
```

Add this formatter near the normalize helpers:

```ts
export function formatTokenUnit(value: number): string {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const units = [
    { suffix: "T", threshold: 1_000_000_000_000 },
    { suffix: "B", threshold: 1_000_000_000 },
    { suffix: "M", threshold: 1_000_000 },
    { suffix: "K", threshold: 1_000 },
  ];

  for (const unit of units) {
    if (safeValue >= unit.threshold) {
      const formatted = (safeValue / unit.threshold).toFixed(1).replace(/\.0$/, "");
      return `${formatted}${unit.suffix}`;
    }
  }

  return String(Math.round(safeValue));
}
```

- [ ] **Step 4: Run focused test to verify pass**

Run: `bun run test src/shared/metrics.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/metrics.ts src/shared/metrics.test.ts
git commit -m "feat: 添加 dashboard 查询类型与 token 单位格式"
```

---

## Task 2: Filtered SQLite Dashboard Queries

**Files:**
- Modify: `src/main/metricsStore.ts`
- Modify: `src/main/metricsStore.test.ts`

- [ ] **Step 1: Write failing filter tests**

Append this test to `src/main/metricsStore.test.ts` inside `describe("MetricsStore", ...)`:

```ts
test("filters dashboard data by time provider and model", () => {
  const metricsStore = createStore();
  metricsStore.insertEvents(baseEvents);

  const data = metricsStore.getDashboardData({
    start: "2026-06-11T00:00:00.000Z",
    end: "2026-06-12T00:00:00.000Z",
    providers: ["anthropic"],
    models: ["claude-haiku-3.5"],
    recentLimit: 10,
  });

  expect(data.today).toEqual({
    requestCount: 1,
    totalTokens: 50,
    inputTokens: 40,
    outputTokens: 10,
    averageTokensPerSecond: 25,
  });
  expect(data.recent.map((row) => row.id)).toEqual(["req-4"]);
  expect(data.modelRanking).toEqual([
    {
      provider: "anthropic",
      model: "claude-haiku-3.5",
      requestCount: 1,
      totalTokens: 50,
      inputTokens: 40,
      outputTokens: 10,
      averageTokensPerSecond: 25,
    },
  ]);
});

test("returns provider and model filter options for the selected time range", () => {
  const metricsStore = createStore();
  metricsStore.insertEvents(baseEvents);

  const data = metricsStore.getDashboardData({
    start: "2026-06-11T00:00:00.000Z",
    end: "2026-06-12T00:00:00.000Z",
    recentLimit: 10,
  });

  expect(data.providers).toEqual([
    { value: "openai", requestCount: 1, totalTokens: 300 },
    { value: "anthropic", requestCount: 2, totalTokens: 200 },
  ]);
  expect(data.models).toEqual([
    { value: "gpt-4.1", requestCount: 1, totalTokens: 300 },
    { value: "claude-sonnet-4", requestCount: 1, totalTokens: 150 },
    { value: "claude-haiku-3.5", requestCount: 1, totalTokens: 50 },
  ]);
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `bun run test src/main/metricsStore.test.ts`

Expected: FAIL because `start/end/providers/models/providers/models` are not implemented.

- [ ] **Step 3: Update query type and SQL filter builder**

In `src/main/metricsStore.ts`, update imports:

```ts
import type { DashboardData, DashboardFilters, MetricEvent } from "../shared/metrics.js";
```

Replace `DashboardQuery` with:

```ts
export interface DashboardQuery extends DashboardFilters {
  recentLimit: number;
}
```

Add helper methods inside `MetricsStore` before `getDashboardData`:

```ts
  private buildWhereClause(query: DashboardQuery): { clause: string; values: BindValues } {
    const conditions = ["timestamp >= ?", "timestamp < ?"];
    const values: BindValues = [query.start, query.end];

    if (query.providers?.length) {
      conditions.push(`provider IN (${query.providers.map(() => "?").join(", ")})`);
      values.push(...query.providers);
    }

    if (query.models?.length) {
      conditions.push(`model IN (${query.models.map(() => "?").join(", ")})`);
      values.push(...query.models);
    }

    return { clause: conditions.join(" AND "), values };
  }

  private buildTimeOnlyWhereClause(query: DashboardQuery): { clause: string; values: BindValues } {
    return { clause: "timestamp >= ? AND timestamp < ?", values: [query.start, query.end] };
  }
```

- [ ] **Step 4: Update dashboard SQL**

At the start of `getDashboardData`, add:

```ts
    const filtered = this.buildWhereClause(query);
    const timeOnly = this.buildTimeOnlyWhereClause(query);
```

Replace all `WHERE timestamp >= ? AND timestamp < ?` query fragments for summary, recent, ranking, and hourly trends with ``WHERE ${filtered.clause}``, and pass `filtered.values` plus `recentLimit` where needed.

For recent query values use:

```ts
[...filtered.values, query.recentLimit]
```

Add provider options before return:

```ts
    const providers = this.database.all(
      `
        SELECT provider AS value,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens
        FROM requests
        WHERE ${timeOnly.clause}
        GROUP BY provider
        ORDER BY totalTokens DESC, requestCount DESC, value ASC
      `,
      timeOnly.values,
    ) as DashboardData["providers"];

    const modelOptionFilter = query.providers?.length
      ? this.buildWhereClause({ ...query, models: undefined })
      : timeOnly;
    const models = this.database.all(
      `
        SELECT model AS value,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens
        FROM requests
        WHERE ${modelOptionFilter.clause}
        GROUP BY model
        ORDER BY totalTokens DESC, requestCount DESC, value ASC
      `,
      modelOptionFilter.values,
    ) as DashboardData["models"];
```

Return `providers` and `models` in the final object.

- [ ] **Step 5: Update existing tests for new query names**

In `src/main/metricsStore.test.ts`, replace every call argument property pair:

```ts
dayStart: "2026-06-11T00:00:00.000Z",
dayEnd: "2026-06-12T00:00:00.000Z",
```

with:

```ts
start: "2026-06-11T00:00:00.000Z",
end: "2026-06-12T00:00:00.000Z",
```

Add `providers` and `models` expected arrays to the existing full dashboard test:

```ts
    expect(data.providers).toEqual([
      { value: "openai", requestCount: 1, totalTokens: 300 },
      { value: "anthropic", requestCount: 2, totalTokens: 200 },
    ]);
    expect(data.models).toEqual([
      { value: "gpt-4.1", requestCount: 1, totalTokens: 300 },
      { value: "claude-sonnet-4", requestCount: 1, totalTokens: 150 },
      { value: "claude-haiku-3.5", requestCount: 1, totalTokens: 50 },
    ]);
```

- [ ] **Step 6: Run focused test to verify pass**

Run: `bun run test src/main/metricsStore.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/metricsStore.ts src/main/metricsStore.test.ts
git commit -m "feat: 支持 dashboard 筛选查询"
```

---

## Task 3: Time Range And Timezone Helpers

**Files:**
- Create: `src/renderer/timeFilters.ts`
- Create: `src/renderer/timeFilters.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/renderer/timeFilters.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { formatTimeInZone, resolveQuickRange, validateCustomRange } from "./timeFilters.js";

describe("resolveQuickRange", () => {
  test("resolves today in local timezone", () => {
    const range = resolveQuickRange("today", new Date("2026-06-12T08:30:00.000Z"), "local");

    expect(new Date(range.start).getHours()).toBe(0);
    expect(new Date(range.end).getTime() - new Date(range.start).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("resolves last 1h relative range", () => {
    const range = resolveQuickRange("1h", new Date("2026-06-12T08:30:00.000Z"), "utc");

    expect(range).toEqual({
      start: "2026-06-12T07:30:00.000Z",
      end: "2026-06-12T08:30:00.000Z",
    });
  });
});

describe("validateCustomRange", () => {
  test("rejects an end before start", () => {
    expect(validateCustomRange("2026-06-12T10:00", "2026-06-12T09:00")).toEqual({
      valid: false,
      message: "End time must be after start time.",
    });
  });

  test("accepts valid datetime-local values", () => {
    expect(validateCustomRange("2026-06-12T09:00", "2026-06-12T10:00")).toEqual({
      valid: true,
      start: new Date("2026-06-12T09:00").toISOString(),
      end: new Date("2026-06-12T10:00").toISOString(),
    });
  });
});

describe("formatTimeInZone", () => {
  test("formats UTC labels", () => {
    expect(formatTimeInZone("2026-06-12T08:30:00.000Z", "utc", { hour: "2-digit", minute: "2-digit" })).toBe("08:30");
  });
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `bun run test src/renderer/timeFilters.test.ts`

Expected: FAIL because `timeFilters.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `src/renderer/timeFilters.ts`:

```ts
export type TimezoneMode = "local" | "utc";
export type QuickRange = "today" | "week" | "month" | "15m" | "1h" | "6h" | "24h" | "7d" | "30d";

export interface ResolvedRange {
  start: string;
  end: string;
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function calendarStart(date: Date, timezone: TimezoneMode, unit: "day" | "week" | "month"): Date {
  const start = timezone === "utc" ? startOfUtcDay(date) : startOfLocalDay(date);

  if (unit === "week") {
    const day = timezone === "utc" ? start.getUTCDay() : start.getDay();
    const offset = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - offset);
  }

  if (unit === "month") {
    if (timezone === "utc") start.setUTCDate(1);
    else start.setDate(1);
  }

  return start;
}

function addCalendarUnit(date: Date, timezone: TimezoneMode, unit: "day" | "week" | "month"): Date {
  const end = new Date(date);
  if (unit === "day") end.setDate(end.getDate() + 1);
  if (unit === "week") end.setDate(end.getDate() + 7);
  if (unit === "month") {
    if (timezone === "utc") end.setUTCMonth(end.getUTCMonth() + 1);
    else end.setMonth(end.getMonth() + 1);
  }
  return end;
}

export function resolveQuickRange(range: QuickRange, now: Date, timezone: TimezoneMode): ResolvedRange {
  const relativeMinutes: Partial<Record<QuickRange, number>> = {
    "15m": 15,
    "1h": 60,
    "6h": 360,
    "24h": 1440,
    "7d": 10080,
    "30d": 43200,
  };
  const minutes = relativeMinutes[range];
  if (minutes) {
    return {
      start: new Date(now.getTime() - minutes * 60 * 1000).toISOString(),
      end: now.toISOString(),
    };
  }

  const unit = range === "week" ? "week" : range === "month" ? "month" : "day";
  const start = calendarStart(now, timezone, unit);
  return { start: start.toISOString(), end: addCalendarUnit(start, timezone, unit).toISOString() };
}

export function validateCustomRange(startValue: string, endValue: string): { valid: false; message: string } | { valid: true; start: string; end: string } {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { valid: false, message: "Start and end time are required." };
  }
  if (start >= end) {
    return { valid: false, message: "End time must be after start time." };
  }
  return { valid: true, start: start.toISOString(), end: end.toISOString() };
}

export function formatTimeInZone(timestamp: string, timezone: TimezoneMode, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    hour12: false,
    timeZone: timezone === "utc" ? "UTC" : undefined,
  }).format(new Date(timestamp));
}
```

- [ ] **Step 4: Run focused test to verify pass**

Run: `bun run test src/renderer/timeFilters.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/timeFilters.ts src/renderer/timeFilters.test.ts
git commit -m "feat: 添加时间范围与时区工具"
```

---

## Task 4: Live Update IPC And Tray Context Menu

**Files:**
- Modify: `src/main/preload.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Update preload IPC API**

In `src/main/preload.ts`, replace the API object with:

```ts
const tokenMetrics: TokenMetricsApi = {
  getDashboardData: (filters) => ipcRenderer.invoke("metrics:get-dashboard-data", filters),
  installPlugin: () => ipcRenderer.invoke("plugin:install"),
  onDashboardUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("metrics:dashboard-updated", listener);
    return () => ipcRenderer.removeListener("metrics:dashboard-updated", listener);
  },
}
```

- [ ] **Step 2: Update main imports**

In `src/main/main.ts`, update Electron import:

```ts
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron"
```

Update shared type import:

```ts
import type { DashboardFilters, DashboardData, MetricEvent } from "../shared/metrics.js"
```

- [ ] **Step 3: Add default dashboard filters and broadcast helper**

Add after `getTodayRange()`:

```ts
function getDefaultDashboardFilters(): DashboardFilters {
  const { dayStart, dayEnd } = getTodayRange()
  return { start: dayStart, end: dayEnd }
}

function broadcastDashboardUpdated() {
  if (!window || window.isDestroyed()) return
  window.webContents.send("metrics:dashboard-updated")
}
```

- [ ] **Step 4: Change dashboard data function signature**

Replace `function getDashboardData(): DashboardData` with:

```ts
function getDashboardData(filters: DashboardFilters = getDefaultDashboardFilters()): DashboardData {
```

Replace the store query call with:

```ts
  const data = store.getDashboardData({ ...filters, recentLimit: 50 })
```

- [ ] **Step 5: Broadcast after data changes**

In `importNewEvents`, after `updateTrayTitle()`, add:

```ts
  if (result.events.length > 0) broadcastDashboardUpdated()
```

In `insertLocalMetric`, after `updateTrayTitle()`, add:

```ts
  broadcastDashboardUpdated()
```

Add this helper before IPC handler registration:

```ts
async function installGlobalPlugin() {
  if (!paths) {
    throw new Error("App paths are not initialized")
  }

  const result = await installPlugin({
    sourcePath: paths.bundledPluginPath,
    targetPath: paths.pluginPath,
    sharedSourcePath: paths.bundledPluginSharedPath,
    sharedTargetPath: paths.pluginSharedPath,
    configPath: paths.configPath,
  })
  updateTrayMenu()
  broadcastDashboardUpdated()
  return result
}
```

Replace `plugin:install` handler with:

```ts
ipcMain.handle("plugin:install", () => installGlobalPlugin())
```

- [ ] **Step 6: Add tray context menu**

Add this function before `createWindow()`:

```ts
function updateTrayMenu() {
  if (!tray) return

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Refresh", click: () => broadcastDashboardUpdated() },
    {
      label: isPluginInstalled() ? "Reinstall Plugin" : "Install Plugin",
      click: () => void installGlobalPlugin().catch((error) => console.warn("Failed to install plugin", error)),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]))
}
```

Then, after `tray.setToolTip(...)`, call:

```ts
  updateTrayMenu()
```

If the disabled install menu feels wrong during implementation, omit that menu item and keep `Refresh` plus `Quit`; the install action remains available in renderer.

- [ ] **Step 7: Update IPC handler signature**

Replace:

```ts
ipcMain.handle("metrics:get-dashboard-data", () => getDashboardData())
```

with:

```ts
ipcMain.handle("metrics:get-dashboard-data", (_event, filters: DashboardFilters) => getDashboardData(filters))
```

- [ ] **Step 8: Run build to verify typing**

Run: `bun run build:main`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/main.ts src/main/preload.ts
git commit -m "feat: 添加实时 dashboard 更新事件"
```

---

## Task 5: Renderer Filtered Live Dashboard

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Replace polling with subscription and filters**

In `src/renderer/App.tsx`, remove `refreshIntervalMs`, `setInterval`, and `clearInterval` usage.

Update imports:

```ts
import { useEffect, useMemo, useRef, useState } from "react"
import type { DashboardData, DashboardFilters } from "../shared/metrics.js"
import { formatTokenUnit } from "../shared/metrics.js"
import { formatTimeInZone, resolveQuickRange, type QuickRange, type TimezoneMode } from "./timeFilters.js"
```

Add state near existing state:

```ts
  const [quickRange, setQuickRange] = useState<QuickRange>("today")
  const [timezone, setTimezone] = useState<TimezoneMode>("local")
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [providerSearch, setProviderSearch] = useState("")
  const [modelSearch, setModelSearch] = useState("")
```

Add filters:

```ts
  const dashboardFilters = useMemo<DashboardFilters>(() => ({
    ...resolveQuickRange(quickRange, new Date(), timezone),
    providers: selectedProviders,
    models: selectedModels,
  }), [quickRange, selectedModels, selectedProviders, timezone])
```

Update `refreshDashboard` to pass filters:

```ts
      const nextDashboard = await window.tokenMetrics.getDashboardData(dashboardFilters)
```

- [ ] **Step 2: Add live subscription effect**

Replace the existing mount effect with:

```ts
  useEffect(() => {
    mountedRef.current = true
    void refreshDashboard({ force: true })
    let timer: number | undefined
    const unsubscribe = window.tokenMetrics.onDashboardUpdated(() => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void refreshDashboard({ force: true }), 120)
    })

    return () => {
      mountedRef.current = false
      if (timer) window.clearTimeout(timer)
      unsubscribe()
    }
  }, [dashboardFilters])
```

If lint complains about function dependencies, move `refreshDashboard` inside the effect or keep the existing ref pattern; do not reintroduce interval polling.

- [ ] **Step 3: Add filter option helpers**

Add before `return`:

```ts
  const providerOptions = dashboard?.providers.filter((option) => option.value.toLowerCase().includes(providerSearch.toLowerCase())) ?? []
  const modelOptions = dashboard?.models.filter((option) => option.value.toLowerCase().includes(modelSearch.toLowerCase())) ?? []

  function toggleValue(value: string, selected: string[], setSelected: (next: string[]) => void) {
    setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }
```

- [ ] **Step 4: Replace rendered layout**

Replace the current JSX inside `<main className="app-shell">` with a compact layout that includes:

```tsx
<header className="app-header">
  <div>
    <p className="eyebrow">OpenCode Tokens</p>
    <h1>{formatTokenUnit(today?.totalTokens ?? 0)}</h1>
    <p className="header-copy">{timezone === "utc" ? "UTC" : "Local"} · event-driven updates</p>
  </div>
  <button className="primary-button" disabled={isInstalling} onClick={handleInstallPlugin} type="button">
    {isInstalling ? "Installing" : dashboard?.pluginInstalled ? "Reinstall" : "Install"}
  </button>
</header>

<section className="filter-panel">
  <div className="chip-row">
    {(["today", "week", "month", "15m", "1h", "6h", "24h", "7d", "30d"] as QuickRange[]).map((range) => (
      <button className={quickRange === range ? "chip active" : "chip"} key={range} onClick={() => setQuickRange(range)} type="button">{range}</button>
    ))}
  </div>
  <label className="select-label">Timezone
    <select value={timezone} onChange={(event) => setTimezone(event.target.value as TimezoneMode)}>
      <option value="local">Local</option>
      <option value="utc">UTC</option>
    </select>
  </label>
  <div className="filter-grid">
    <MultiSelect title="Provider" search={providerSearch} onSearch={setProviderSearch} options={providerOptions} selected={selectedProviders} onToggle={(value) => toggleValue(value, selectedProviders, setSelectedProviders)} onClear={() => setSelectedProviders([])} />
    <MultiSelect title="Model" search={modelSearch} onSearch={setModelSearch} options={modelOptions} selected={selectedModels} onToggle={(value) => toggleValue(value, selectedModels, setSelectedModels)} onClear={() => setSelectedModels([])} />
  </div>
</section>
```

Keep notices, summary, chart, ranking, recent, and settings sections, but update their number formatting to use `formatTokenUnit` and timestamp formatting to use `formatTimeInZone`.

- [ ] **Step 5: Add MultiSelect component**

Add below `EmptyState`:

```tsx
function MultiSelect({ title, search, onSearch, options, selected, onToggle, onClear }: {
  title: string
  search: string
  onSearch: (value: string) => void
  options: { value: string; requestCount: number; totalTokens: number }[]
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  return (
    <div className="multi-select">
      <div className="multi-select-head">
        <strong>{title}</strong>
        <button onClick={onClear} type="button">Clear</button>
      </div>
      <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} />
      <div className="option-list">
        {options.map((option) => (
          <button className={selected.includes(option.value) ? "option-chip selected" : "option-chip"} key={option.value} onClick={() => onToggle(option.value)} type="button">
            <span>{option.value}</span>
            <small>{formatTokenUnit(option.totalTokens)} · {option.requestCount} req</small>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run renderer type build**

Run: `bun run build:renderer`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: 添加筛选式实时 dashboard"
```

---

## Task 6: Midnight Terminal Styling

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Replace visual system styles**

Update `src/renderer/styles.css` to keep existing class names but shift the style system:

```css
:root {
  color: #dbeafe;
  background: #070d16;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body { margin: 0; }
button, input, select { font: inherit; }

.app-shell {
  display: grid;
  gap: 12px;
  min-height: 100vh;
  padding: 14px;
  background: #070d16;
}

.app-header, .filter-panel, .panel, .metric-card, .empty-card {
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.68);
  box-shadow: 0 16px 44px rgba(2, 6, 23, 0.28);
}

.app-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
}

.eyebrow { margin: 0 0 4px; color: #67e8f9; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 0; font-size: 34px; letter-spacing: -.05em; }
h2 { margin: 0; font-size: 15px; }
.header-copy { margin: 4px 0 0; color: #94a3b8; font-size: 12px; }

.primary-button, .chip, .option-chip, .multi-select button {
  border: 1px solid rgba(34, 211, 238, 0.28);
  border-radius: 999px;
  color: #a5f3fc;
  background: rgba(8, 47, 73, 0.24);
  cursor: pointer;
}

.primary-button { padding: 8px 12px; }
.primary-button:disabled { opacity: .65; cursor: wait; }

.filter-panel { display: grid; gap: 10px; padding: 12px; border-radius: 16px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 6px 9px; color: #94a3b8; background: transparent; border-color: rgba(148, 163, 184, .18); }
.chip.active { color: #a5f3fc; background: rgba(34, 211, 238, .12); border-color: rgba(34, 211, 238, .38); }
.select-label { display: grid; gap: 5px; color: #94a3b8; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
select, input { color: #dbeafe; background: #08111f; border: 1px solid rgba(148, 163, 184, .18); border-radius: 10px; padding: 8px; }
.filter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.multi-select { display: grid; gap: 8px; min-width: 0; }
.multi-select-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.multi-select-head strong { font-size: 12px; color: #cbd5e1; }
.multi-select-head button { padding: 4px 8px; color: #94a3b8; border-color: rgba(148, 163, 184, .18); background: transparent; }
.option-list { display: flex; flex-wrap: wrap; gap: 6px; max-height: 84px; overflow: auto; }
.option-chip { display: grid; gap: 2px; padding: 6px 8px; text-align: left; border-color: rgba(148, 163, 184, .16); background: rgba(15, 23, 42, .64); }
.option-chip.selected { border-color: rgba(34, 211, 238, .42); background: rgba(34, 211, 238, .12); }
.option-chip small { color: #64748b; }
```

Keep or adapt the existing chart, table, settings, empty, and responsive blocks so the UI remains usable at the current `520x680` window size.

- [ ] **Step 2: Run renderer build**

Run: `bun run build:renderer`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles.css
git commit -m "style: 调整 dashboard 为终端科技风"
```

---

## Task 7: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun run test src/shared/metrics.test.ts src/main/metricsStore.test.ts src/renderer/timeFilters.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `bun run build`

Expected: PASS. The existing Vite chunk size warning is acceptable.

- [ ] **Step 4: Manual app check**

Run renderer and app in separate terminals:

```bash
bun run dev
bun run dev:app
```

Expected:
- Menu bar shows visible `OC` status.
- Clicking tray opens the popover.
- Provider/model search filters narrow results.
- Time presets change summary/trends/recent rows.
- New OpenCode metric updates the dashboard without a 2-second polling delay.

- [ ] **Step 5: Commit any verification-only fixes**

If fixes were required during verification, commit only those files:

```bash
git add <fixed-files>
git commit -m "fix: 完善 dashboard 体验验证问题"
```

---

## Self-Review Notes

- Spec coverage: tray behavior, live IPC, filter query model, time presets, timezone display, provider/model search, visual structure, token units, error handling, and testing are covered by Tasks 1-7.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation placeholders remain.
- Type consistency: `DashboardFilters`, `FilterOption`, `formatTokenUnit`, `QuickRange`, and `TimezoneMode` are introduced before later tasks reference them.
