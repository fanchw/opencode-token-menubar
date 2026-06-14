# 技术债务清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 optimization #7/#9/#10 三项技术债务 + 文档同步

**Architecture:** 先做最小改动（#10 SQL 校验），再纯重构（#9 全局状态收敛），最后核心改动（#7 IPC 通道拆分 + renderer 智能刷新），文档清理收尾。

**Tech Stack:** TypeScript, Electron IPC, node-sqlite3-wasm, React, Vitest

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/main/metricsStore.ts` | Modify | 拆分 `getDashboardData` 为独立方法；加 `assertValidTrendInterval` |
| `src/main/metricsStore.test.ts` | Modify | 新增拆分方法的测试 |
| `src/main/main.ts` | Modify | 全局状态收敛到 `state` 对象；新增 4 个 IPC handler |
| `src/main/preload.ts` | Modify | 暴露拆分后的 IPC 方法 |
| `src/shared/metrics.ts` | Modify | 新增拆分响应类型；扩展 `TokenMetricsApi` |
| `src/renderer/App.tsx` | Modify | 智能刷新策略（summary+recent 每次刷，ranking+trends 每 5 次刷） |
| `CLAUDE.md` | Modify | 移除已完成 i18n TODO |
| `docs/superpowers/plans/*.md` | Modify | 补完成标记 |

---

### Task 1: 趋势 SQL allowlist 校验（#10）

**Files:**
- Modify: `src/main/metricsStore.ts`
- Test: `src/main/metricsStore.test.ts`

- [ ] **Step 1: 写失败测试 — 无效 interval 抛错**

在 `src/main/metricsStore.test.ts` 末尾的 `describe` 块内新增：

```typescript
  test("getTrends throws on invalid trend interval", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);

    expect(() =>
      metricsStore.getTrends({
        start: "2026-06-11T00:00:00.000Z",
        end: "2026-06-12T00:00:00.000Z",
      }),
    ).not.toThrow();
  });
```

> 注意：这个测试验证正常路径不抛错。`getTrends` 方法尚不存在，所以会编译失败。

- [ ] **Step 2: 运行测试确认失败**

Run: `bun run test -- src/main/metricsStore.test.ts`
Expected: FAIL — `metricsStore.getTrends is not a function`

- [ ] **Step 3: 添加 `VALID_TREND_INTERVALS` 和 `assertValidTrendInterval`**

在 `src/main/metricsStore.ts` 中，在 `chooseTrendInterval` 函数之后添加：

```typescript
const VALID_TREND_INTERVALS = new Set([60, 300, 3600, 21600, 86400]);

function assertValidTrendInterval(seconds: number): void {
  if (!VALID_TREND_INTERVALS.has(seconds)) {
    throw new Error(`Invalid trend interval: ${seconds}`);
  }
}
```

- [ ] **Step 4: 拆分 `getTrends` 方法**

从 `getDashboardData` 中提取 trends 查询逻辑为独立的 `getTrends` 方法。在 `getDashboardData` 方法之后添加：

```typescript
  getTrends({ start, end, providers, models }: DashboardQuery): {
    trends: import("../shared/metrics.js").HourlyTrendRow[];
    trendIntervalSeconds: number;
  } {
    const filters = this.buildFilterClause(start, end, providers, models);
    const trendIntervalSeconds = chooseTrendInterval(
      new Date(start).getTime(),
      new Date(end).getTime(),
    );
    assertValidTrendInterval(trendIntervalSeconds);

    const trendBuckets = this.database.all(
      `
        SELECT
          (CAST(strftime('%s', timestamp) AS INTEGER) / ${trendIntervalSeconds}) * ${trendIntervalSeconds} AS bucketEpoch,
          SUM(tokens) AS totalTokens,
          SUM(inputTokens) AS inputTokens,
          SUM(outputTokens) AS outputTokens,
          SUM(cacheTokens) AS cacheTokens,
          AVG(speed) AS averageTokensPerSecond
        FROM requests
        ${filters.whereClause}
        GROUP BY bucketEpoch
        ORDER BY bucketEpoch ASC
      `,
      filters.values,
    ) as TrendBucket[];

    const trends = trendBuckets.map((bucket) => ({
      hour: new Date(bucket.bucketEpoch * 1000).toISOString(),
      totalTokens: bucket.totalTokens,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      cacheTokens: bucket.cacheTokens,
      averageTokensPerSecond: bucket.averageTokensPerSecond,
    }));

    return { trends, trendIntervalSeconds };
  }
```

- [ ] **Step 5: 拆分 `getSummary` 方法**

在 `getTrends` 方法之后添加：

```typescript
  getSummary({ start, end, providers, models }: DashboardQuery): import("../shared/metrics.js").TodaySummary {
    const filters = this.buildFilterClause(start, end, providers, models);
    const row = this.database.get(
      `
        SELECT
          COUNT(*) AS requestCount,
          COALESCE(SUM(tokens), 0) AS totalTokens,
          COALESCE(SUM(inputTokens), 0) AS inputTokens,
          COALESCE(SUM(outputTokens), 0) AS outputTokens,
          COALESCE(SUM(cacheTokens), 0) AS cacheTokens,
          COALESCE(AVG(speed), 0) AS averageTokensPerSecond
        FROM requests
        ${filters.whereClause}
      `,
      filters.values,
    ) as SummaryRow | undefined;

    return {
      requestCount: row?.requestCount ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      cacheTokens: row?.cacheTokens ?? 0,
      averageTokensPerSecond: row?.averageTokensPerSecond ?? 0,
    };
  }
```

- [ ] **Step 6: 拆分 `getRecent` 方法**

在 `getSummary` 方法之后添加：

```typescript
  getRecent({ start, end, providers, models, recentPage, recentPageSize }: DashboardQuery): {
    rows: import("../shared/metrics.js").MetricEvent[];
    total: number;
  } {
    const filters = this.buildFilterClause(start, end, providers, models);
    const page = typeof recentPage === "number" && recentPage >= 1 ? Math.floor(recentPage) : 1;
    const pageSize =
      typeof recentPageSize === "number" && recentPageSize >= 1 ? Math.floor(recentPageSize) : 50;
    const offset = (page - 1) * pageSize;

    const rows = this.database.all(
      `
        SELECT id,
          timestamp,
          provider,
          model,
          inputTokens,
          outputTokens,
          cacheTokens,
          firstTokenLatencyMs,
          tokens AS totalTokens,
          duration AS durationMs,
          speed AS tokensPerSecond
        FROM requests
        ${filters.whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `,
      [...filters.values, pageSize, offset],
    ) as import("../shared/metrics.js").MetricEvent[];

    const countRow = this.database.get(
      `SELECT COUNT(*) AS count FROM requests ${filters.whereClause}`,
      filters.values,
    ) as { count: number } | undefined;

    return { rows, total: countRow?.count ?? 0 };
  }
```

- [ ] **Step 7: 拆分 `getRanking` 方法**

在 `getRecent` 方法之后添加：

```typescript
  getRanking({ start, end, providers, models }: DashboardQuery): import("../shared/metrics.js").ModelRankingRow[] {
    const filters = this.buildFilterClause(start, end, providers, models);
    return this.database.all(
      `
        SELECT provider,
          model,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens,
          SUM(inputTokens) AS inputTokens,
          SUM(outputTokens) AS outputTokens,
          SUM(cacheTokens) AS cacheTokens,
          AVG(speed) AS averageTokensPerSecond
        FROM requests
        ${filters.whereClause}
        GROUP BY provider, model
        ORDER BY totalTokens DESC, requestCount DESC, provider ASC, model ASC
      `,
      filters.values,
    ) as import("../shared/metrics.js").ModelRankingRow[];
  }
```

- [ ] **Step 8: 拆分 `getFilterOptions` 方法**

在 `getRanking` 方法之后添加：

```typescript
  getFilterOptions({ start, end, providers }: DashboardQuery): {
    providers: import("../shared/metrics.js").FilterOption[];
    models: import("../shared/metrics.js").FilterOption[];
  } {
    const providerFilters = this.buildFilterClause(start, end);
    const modelFilters = this.buildFilterClause(start, end, providers);

    const providerOptions = this.database.all(
      `
        SELECT provider AS value,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens
        FROM requests
        ${providerFilters.whereClause}
        GROUP BY provider
        ORDER BY totalTokens DESC, requestCount DESC, value ASC
      `,
      providerFilters.values,
    ) as import("../shared/metrics.js").FilterOption[];

    const modelOptions = this.database.all(
      `
        SELECT model AS value,
          COUNT(*) AS requestCount,
          SUM(tokens) AS totalTokens
        FROM requests
        ${modelFilters.whereClause}
        GROUP BY model
        ORDER BY totalTokens DESC, requestCount DESC, value ASC
      `,
      modelFilters.values,
    ) as import("../shared/metrics.js").FilterOption[];

    return { providers: providerOptions, models: modelOptions };
  }
```

- [ ] **Step 9: 重构 `getDashboardData` 复用拆分方法**

将 `getDashboardData` 方法体替换为调用拆分方法：

```typescript
  getDashboardData(query: DashboardQuery): DashboardData {
    const summary = this.getSummary(query);
    const recent = this.getRecent(query);
    const modelRanking = this.getRanking(query);
    const { trends: hourlyTrends, trendIntervalSeconds } = this.getTrends(query);
    const { providers, models } = this.getFilterOptions(query);

    return {
      today: summary,
      recent: recent.rows,
      recentTotal: recent.total,
      modelRanking,
      hourlyTrends,
      trendIntervalSeconds,
      providers,
      models,
    };
  }
```

- [ ] **Step 10: 运行测试确认全部通过**

Run: `bun run test -- src/main/metricsStore.test.ts`
Expected: PASS — 所有现有测试 + 新测试通过

- [ ] **Step 11: Commit**

```bash
git add src/main/metricsStore.ts src/main/metricsStore.test.ts
git commit -m "refactor: 拆分 getDashboardData 为独立查询方法并加 SQL 校验"
```

---

### Task 2: 全局状态收敛（#9）

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: 定义 `AppState` 接口并初始化**

在 `src/main/main.ts` 中，将第 16-26 行的 11 个模块级 `let` 替换为：

```typescript
interface AppState {
  tray: Tray | null
  window: BrowserWindow | null
  store: MetricsStore | null
  watcher: FSWatcher | null
  ingestServer: IngestServerHandle | null
  eventBuffer: EventBuffer | null
  paths: AppPaths | null
  importStatePath: string | null
  jsonlOffset: number
  importErrors: number
  isShuttingDown: boolean
}

const state: AppState = {
  tray: null,
  window: null,
  store: null,
  watcher: null,
  ingestServer: null,
  eventBuffer: null,
  paths: null,
  importStatePath: null,
  jsonlOffset: 0,
  importErrors: 0,
  isShuttingDown: false,
}
```

- [ ] **Step 2: 全局替换变量引用**

将文件中所有以下裸变量引用替换为 `state.` 前缀（使用 `replaceAll` 或逐个替换）：

| 旧引用 | 新引用 |
|--------|--------|
| `tray` (非参数/局部变量) | `state.tray` |
| `window` (非参数/局部变量，非 `BrowserWindow`) | `state.window` |
| `store` (非参数/局部变量) | `state.store` |
| `watcher` | `state.watcher` |
| `ingestServer` | `state.ingestServer` |
| `eventBuffer` | `state.eventBuffer` |
| `paths` (非参数/局部变量) | `state.paths` |
| `importStatePath` | `state.importStatePath` |
| `jsonlOffset` | `state.jsonlOffset` |
| `importErrors` | `state.importErrors` |
| `isShuttingDown` | `state.isShuttingDown` |

特别注意以下函数需要修改的引用：
- `writeImportState()`: `importStatePath` → `state.importStatePath`, `jsonlOffset` → `state.jsonlOffset`, `importErrors` → `state.importErrors`
- `getDashboardPaths()`: `paths` → `state.paths`
- `isPluginInstalled()`: `paths` → `state.paths`
- `broadcastDashboardUpdated()`: `window` → `state.window`
- `syncModelCatalog()`: `store` → `state.store`
- `getDashboardData()`: `store` → `state.store`, `paths` → `state.paths`, `importErrors` → `state.importErrors`
- `updateTrayTitle()`: `tray` → `state.tray`, `store` → `state.store`
- `installGlobalPlugin()`: `paths` → `state.paths`
- `buildTrayMenu()`: `importNewEvents()`, `isPluginInstalled()`, `installGlobalPlugin()` 内部引用已通过 state 改变
- `importNewEvents()`: `store` → `state.store`, `paths` → `state.paths`, `jsonlOffset` → `state.jsonlOffset`, `importErrors` → `state.importErrors`
- `insertLocalMetric()`: `eventBuffer` → `state.eventBuffer`
- `watchMetricEvents()`: `paths` → `state.paths`, `watcher` → `state.watcher`
- `createWindow()`: `window` → `state.window`
- `toggleWindow()`: `window` → `state.window`, `tray` → `state.tray`
- `app.whenReady().then(...)`: 所有赋值语句 `paths = ...` → `state.paths = ...` 等
- `app.on("before-quit")`: `isShuttingDown`, `watcher`, `ingestServer`, `eventBuffer`, `store` 全部加 `state.` 前缀

注意：赋值语法从 `tray = new Tray(...)` 改为 `state.tray = new Tray(...)`。

- [ ] **Step 3: 运行构建确认编译通过**

Run: `bun run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 4: Commit**

```bash
git add src/main/main.ts
git commit -m "refactor: 收敛 main.ts 模块级变量到 AppState 对象"
```

---

### Task 3: 新增 IPC 通道 + 类型定义（#7 第一步）

**Files:**
- Modify: `src/shared/metrics.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: 新增拆分响应类型到 `src/shared/metrics.ts`**

在 `DashboardData` 接口之后（约第 100 行后）添加：

```typescript
export interface SummaryResponse {
  today: TodaySummary;
  providers: FilterOption[];
  models: FilterOption[];
  modelProviders?: Record<string, string[]>;
  importErrors?: number;
  pluginInstalled?: boolean;
  paths?: {
    jsonlPath: string;
    ingestPath: string;
    sqlitePath: string;
    pluginPath: string;
  };
}

export interface RecentResponse {
  rows: MetricEvent[];
  total: number;
}

export interface TrendsResponse {
  trends: HourlyTrendRow[];
  trendIntervalSeconds: number;
}

export interface DashboardUpdatePayload {
  reason: "new-data" | "catalog-sync";
}
```

- [ ] **Step 2: 扩展 `TokenMetricsApi` 接口**

将 `src/shared/metrics.ts` 中的 `TokenMetricsApi` 接口替换为：

```typescript
export interface TokenMetricsApi {
  getDashboardData(filters: DashboardFilters): Promise<DashboardData>;
  getSummary(filters: DashboardFilters): Promise<SummaryResponse>;
  getRecent(filters: DashboardFilters): Promise<RecentResponse>;
  getRanking(filters: DashboardFilters): Promise<ModelRankingRow[]>;
  getTrends(filters: DashboardFilters): Promise<TrendsResponse>;
  installPlugin(): Promise<{ installed: true; targetPath: string }>;
  onDashboardUpdated(callback: (payload: DashboardUpdatePayload) => void): () => void;
}
```

- [ ] **Step 3: 在 `main.ts` 中添加 `getSummaryData` 辅助函数**

在 `getDashboardData` 函数之后添加（该函数组合 catalog 数据，专供 `metrics:get-summary` 使用）：

```typescript
function getSummaryData(filters = getDefaultDashboardFilters()): SummaryResponse {
  if (!state.store || !state.paths) {
    throw new Error("Metrics store is not initialized")
  }

  const summary = state.store.getSummary(filters)
  const { providers: dataProviders, models: dataModels } = state.store.getFilterOptions(filters)

  const knownProviders = new Set(dataProviders.map((option) => option.value))
  const catalogProviders = state.store
    .getCatalogProviders()
    .filter((value) => !knownProviders.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  const knownModels = new Set(dataModels.map((option) => option.value))
  const catalogModels = state.store
    .getCatalogModels()
    .filter((value) => !knownModels.has(value))
    .map((value) => ({ value, requestCount: 0, totalTokens: 0 }))

  return {
    today: summary,
    providers: [...dataProviders, ...catalogProviders],
    models: [...dataModels, ...catalogModels],
    modelProviders: state.store.getModelProviderMap(),
    importErrors: state.importErrors,
    pluginInstalled: isPluginInstalled(),
    paths: getDashboardPaths(),
  }
}
```

需要在 `main.ts` 顶部导入新类型：

```typescript
import type { DashboardData, DashboardFilters, MetricEvent, SummaryResponse, RecentResponse, TrendsResponse, DashboardUpdatePayload } from "../shared/metrics.js"
```

- [ ] **Step 4: 注册 4 个新 IPC handler**

在 `main.ts` 的 `app.whenReady().then(...)` 中，在现有 `ipcMain.handle("metrics:get-dashboard-data", ...)` 之后添加：

```typescript
  ipcMain.handle("metrics:get-summary", (_event, filters: unknown) => {
    return getSummaryData(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("metrics:get-recent", (_event, filters: unknown) => {
    if (!state.store) throw new Error("Metrics store is not initialized")
    return state.store.getRecent(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("metrics:get-ranking", (_event, filters: unknown) => {
    if (!state.store) throw new Error("Metrics store is not initialized")
    return state.store.getRanking(normalizeDashboardFilters(filters))
  })
  ipcMain.handle("metrics:get-trends", (_event, filters: unknown) => {
    if (!state.store) throw new Error("Metrics store is not initialized")
    return state.store.getTrends(normalizeDashboardFilters(filters))
  })
```

- [ ] **Step 5: 修改 `broadcastDashboardUpdated` 携带 payload**

将 `broadcastDashboardUpdated` 函数替换为：

```typescript
function broadcastDashboardUpdated(payload: DashboardUpdatePayload = { reason: "new-data" }) {
  if (!state.window || state.window.isDestroyed() || state.window.webContents.isDestroyed()) return

  state.window.webContents.send("metrics:dashboard-updated", payload)
}
```

注意：`catalog-sync` reason 目前暂不使用（预留给后续 catalog 变更场景），所有现有调用点默认传 `new-data`。

- [ ] **Step 6: 更新 `preload.ts` 暴露新方法**

将 `src/main/preload.ts` 替换为：

```typescript
import { contextBridge, ipcRenderer } from "electron"

import type { TokenMetricsApi } from "../shared/metrics.js"

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
}

contextBridge.exposeInMainWorld("tokenMetrics", tokenMetrics)
```

- [ ] **Step 7: 运行构建确认编译通过**

Run: `bun run build`
Expected: 构建成功

- [ ] **Step 8: Commit**

```bash
git add src/shared/metrics.ts src/main/main.ts src/main/preload.ts
git commit -m "feat: 拆分 IPC 通道支持增量数据拉取"
```

---

### Task 4: Renderer 智能刷新策略（#7 第二步）

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 新增 `updateCountRef` 和增量刷新函数**

在 `src/renderer/App.tsx` 中，在 `debounceTimerRef` 之后（约第 38 行）添加：

```typescript
  const updateCountRef = useRef(0)
```

- [ ] **Step 2: 新增 `refreshLight` 和 `refreshHeavy` 函数**

在 `refreshDashboard` 函数之后添加两个增量刷新函数：

```typescript
  const refreshSummary = useCallback(async (nextFilters: DashboardFilters) => {
    if (!mountedRef.current || inFlightRef.current) return

    inFlightRef.current = true
    try {
      const [summary, recent] = await Promise.all([
        window.tokenMetrics.getSummary(nextFilters),
        window.tokenMetrics.getRecent(nextFilters),
      ])
      if (mountedRef.current) {
        setDashboard((prev) => prev ? {
          ...prev,
          today: summary.today,
          providers: summary.providers,
          models: summary.models,
          modelProviders: summary.modelProviders,
          importErrors: summary.importErrors,
          pluginInstalled: summary.pluginInstalled,
          paths: summary.paths,
          recent: recent.rows,
          recentTotal: recent.total,
        } : null)
        setError(null)
      }
    } catch (caughtError) {
      if (mountedRef.current) {
        setError(caughtError instanceof Error ? caughtError.message : t("notice.unableLoad"))
      }
    } finally {
      inFlightRef.current = false
    }
  }, [])

  const refreshHeavy = useCallback(async (nextFilters: DashboardFilters) => {
    if (!mountedRef.current) return

    try {
      const [ranking, trends] = await Promise.all([
        window.tokenMetrics.getRanking(nextFilters),
        window.tokenMetrics.getTrends(nextFilters),
      ])
      if (mountedRef.current) {
        setDashboard((prev) => prev ? {
          ...prev,
          modelRanking: ranking,
          hourlyTrends: trends.trends,
          trendIntervalSeconds: trends.trendIntervalSeconds,
        } : null)
      }
    } catch {
      // heavy refresh 失败不阻塞 UI
    }
  }, [])
```

- [ ] **Step 3: 修改 `onDashboardUpdated` 回调使用智能刷新策略**

将 `useEffect` 中的 `onDashboardUpdated` 回调替换为：

```typescript
    const unsubscribe = window.tokenMetrics.onDashboardUpdated((payload) => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null
        const nextFilters = latestFiltersRef.current
        if (!nextFilters) return

        updateCountRef.current += 1
        void refreshSummary(nextFilters)

        if (updateCountRef.current % 5 === 0) {
          void refreshHeavy(nextFilters)
        }
      }, debounceMs)
    })
```

- [ ] **Step 4: filter 变化时全量刷新（复用 `refreshDashboard`）**

现有的 `useEffect` 保持不变（filter 变化时调用 `refreshDashboard` 做全量拉取）。同时在 filter 变化时重置计数器：

将现有 filter 变化的 `useEffect` 修改为：

```typescript
  useEffect(() => {
    latestFiltersRef.current = filters
    updateCountRef.current = 0
    void refreshDashboard(filters)
  }, [filters, refreshDashboard])
```

- [ ] **Step 5: 更新 `useEffect` 依赖数组**

更新 `onDashboardUpdated` 的 `useEffect` 依赖：

```typescript
  }, [refreshDashboard, refreshSummary, refreshHeavy])
```

- [ ] **Step 6: 运行构建确认编译通过**

Run: `bun run build`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: renderer 智能刷新策略 summary+recent 每次刷 ranking+trends 每5次刷"
```

---

### Task 5: 运行全量测试 + 构建验证

**Files:** 无修改

- [ ] **Step 1: 运行全部测试**

Run: `bun run test`
Expected: 所有测试通过

- [ ] **Step 2: 运行构建**

Run: `bun run build`
Expected: 构建成功，无错误

- [ ] **Step 3: 手动启动 dev 验证功能正常**

```bash
bun run dev
# 另一个终端
bun run dev:app
```

验证：
- Dashboard 正常加载，所有面板有数据
- 等待新的 metric 事件，summary + recent 刷新正常
- 切换 filter（时间范围、provider、model），全量刷新正常
- tray tooltip 正常更新

---

### Task 6: 文档清理

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-06-11-opencode-token-menubar.md`
- Modify: `docs/superpowers/plans/2026-06-12-local-ingest.md`
- Modify: `docs/superpowers/plans/2026-06-12-menubar-live-dashboard.md`
- Modify: `.claude/memory/project/overview.md`
- Modify: `.claude/memory/project/optimization.md`

- [ ] **Step 1: 移除 CLAUDE.md 已完成的 i18n TODO**

将 `CLAUDE.md` 中的 `## TODO` 章节：

```markdown
## TODO

- **国际化**：支持英文和简体中文。采用轻量内置方案（`t(key)` 字典函数，0 依赖），key 结构和字典 JSON 与 i18next 保持一致，便于后续无缝迁移到 `react-i18next`。
```

替换为：

```markdown
## TODO

- （暂无）
```

- [ ] **Step 2: 为 3 份旧 plan 补完成标记**

在以下 3 个文件的标题行之后添加 `> 状态: ✅ 已完成`：

- `docs/superpowers/plans/2026-06-11-opencode-token-menubar.md`
- `docs/superpowers/plans/2026-06-12-local-ingest.md`
- `docs/superpowers/plans/2026-06-12-menubar-live-dashboard.md`

- [ ] **Step 3: 更新 optimization.md 标记 #7/#9/#10 为已完成**

在 `.claude/memory/project/optimization.md` 中，将 #7、#9、#10 的状态标记为 `✅ 完成`。

- [ ] **Step 4: 更新 overview.md TODO 章节**

在 `.claude/memory/project/overview.md` 中，更新 TODO 部分反映技术债务清理已完成。

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/ .claude/memory/
git commit -m "docs: 清理过期 TODO 并同步技术债务完成状态"
```
