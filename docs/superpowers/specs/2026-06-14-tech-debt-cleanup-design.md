# 技术债务清理设计

> 日期: 2026-06-14
> 状态: 已批准
> 关联: optimization.md #7, #9, #10

## 背景

项目核心功能、性能优化 #1-6、CI/CD 发版流程均已闭环（v0.0.2）。本次清理剩余 4 项技术债务，为后续新功能（费用估算、通知告警）铺路。

## 范围

| 项 | 优化编号 | 优先级 | 内容 |
|----|---------|--------|------|
| IPC 通道拆分 | #7 | 中 | 消除全量刷新，trends/ranking 按需拉取 |
| 全局状态收敛 | #9 | 低 | 11 个模块级 `let` → `AppState` 对象 |
| 趋势 SQL 安全 | #10 | 低 | `trendIntervalSeconds` 插值加 allowlist 校验 |
| 文档清理 | — | 低 | CLAUDE.md 过期 TODO + plan 完成标记 |

> **i18n 覆盖**：经扫描，`src/renderer/` 所有 `.tsx` 组件已 100% 通过 `t()` 调用，无硬编码中文字符串。此项已完成，不在本次范围内。

## 设计

### 1. IPC 通道拆分（#7）

#### 问题

当前 `metrics:dashboard-updated` 事件触发 renderer 调用 `getDashboardData(filters)`，一次拉取全部 5 类数据（summary + recent + ranking + trends + options）。其中 trends 查询最重（按时间桶聚合全部 requests 行），高频 metric 事件下大部分 trends/ranking 数据未变却重复计算。

#### 方案：拆分 IPC 通道 + renderer 智能刷新

**Store 层** — `metricsStore.ts` 拆分 `getDashboardData` 为独立方法：

```typescript
// 各方法独立接收 DashboardQuery，内部只查自己负责的数据
getSummary(query: DashboardQuery): TodaySummary
getRecent(query: DashboardQuery): { rows: MetricEvent[]; total: number }
getRanking(query: DashboardQuery): ModelRankingRow[]
getTrends(query: DashboardQuery): { trends: HourlyTrendRow[]; intervalSeconds: number }
getFilterOptions(query: DashboardQuery): { providers: FilterOption[]; models: FilterOption[] }
```

保留 `getDashboardData` 作为组合方法（内部调用上述 5 个），供初次加载使用。

**IPC 层** — `main.ts` + `preload.ts` 新增 4 个 invoke 通道：

| IPC channel | Store 方法 | 刷新成本 |
|-------------|-----------|---------|
| `metrics:get-summary` | `getSummary` | 低（1 条聚合 SQL） |
| `metrics:get-recent` | `getRecent` | 低（分页 LIMIT/OFFSET） |
| `metrics:get-ranking` | `getRanking` | 中（GROUP BY provider+model） |
| `metrics:get-trends` | `getTrends` | **高**（按时间桶聚合全表） |

`getFilterOptions` 合并到 `get-summary` 响应中（都是轻量查询，provider/model 列表变更频率极低）。

**事件层** — `metrics:dashboard-updated` 事件携带 payload：

```typescript
interface DashboardUpdatePayload {
  reason: "new-data" | "catalog-sync"
}
```

**Renderer 层** — 智能刷新策略：

| 触发条件 | 刷新内容 |
|---------|---------|
| `dashboard-updated` 事件（reason=new-data） | summary + recent |
| `dashboard-updated` 事件（reason=new-data，第 5 次） | summary + recent + ranking + trends |
| filter 变化 | 全部（复用 `getDashboardData` 组合方法） |
| 初次加载 | 全部 |

实现方式：renderer 维护 `updateCountRef`，每次 `dashboard-updated` 累加，每 5 次全量刷新一次 trends/ranking。

**preload.ts** — `TokenMetricsApi` 接口扩展：

```typescript
export interface TokenMetricsApi {
  getDashboardData(filters: DashboardFilters): Promise<DashboardData>
  getSummary(filters: DashboardFilters): Promise<SummaryResponse>
  getRecent(filters: DashboardFilters): Promise<RecentResponse>
  getRanking(filters: DashboardFilters): Promise<ModelRankingRow[]>
  getTrends(filters: DashboardFilters): Promise<TrendsResponse>
  installPlugin(): Promise<{ installed: true; targetPath: string }>
  onDashboardUpdated(callback: (payload: DashboardUpdatePayload) => void): () => void
}
```

#### 不做什么

- 不做 diff-based 推送（server 端维护快照对比，复杂度高）
- 不做 WebSocket 双向通信（Electron IPC 已足够）
- 不拆分 EventBuffer（200ms 批量合并已足够）

### 2. 全局状态收敛（#9）

#### 问题

`main.ts` 有 11 个模块级 `let` 变量，分散在各处，测试时难以 mock，生命周期不清晰。

#### 方案

收敛到单个 `AppState` 对象：

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

所有引用从 `tray` 改为 `state.tray`，以此类推。不做依赖注入，保持 Electron main 进程的简单性。

### 3. 趋势 SQL 安全（#10）

#### 问题

```sql
(CAST(strftime('%s', timestamp) AS INTEGER) / ${trendIntervalSeconds}) * ${trendIntervalSeconds}
```

`trendIntervalSeconds` 直接插值到 SQL。当前值来自 `chooseTrendInterval()` 返回固定枚举 `{60, 300, 3600, 21600, 86400}`，无注入风险。但模式不佳。

#### 方案

SQLite 不支持 GROUP BY 表达式中绑定参数，因此无法改为 `?` 参数化。采用 allowlist 校验：

```typescript
const VALID_TREND_INTERVALS = new Set([60, 300, 3600, 21600, 86400])

function assertValidTrendInterval(seconds: number): void {
  if (!VALID_TREND_INTERVALS.has(seconds)) {
    throw new Error(`Invalid trend interval: ${seconds}`)
  }
}
```

在 `getTrends` 方法入口调用校验，保持插值但确保输入受控。

### 4. 文档清理

- **CLAUDE.md**：移除 `## TODO` 章节中已完成的 i18n 条目
- **plan 完成标记**：为 `docs/superpowers/plans/` 下 3 份缺标记的 plan 补充 `✅ 已完成` 头部

## 测试策略

- **Store 层**：现有 `metricsStore.test.ts` 测试 `getDashboardData`，新增拆分方法的独立测试
- **IPC 层**：不单独测试 IPC（Electron 集成测试成本高），靠 Store 层覆盖
- **Renderer 层**：现有 `App.test.ts` 验证全量刷新流程，扩展验证增量刷新策略
- **全局状态**：不单独测试（纯重构，行为不变）

## 实施顺序

1. #10 SQL 校验（最小改动，先清掉）
2. #9 全局状态收敛（纯重构，不影响功能）
3. #7 IPC 通道拆分（核心改动，最后做）
4. 文档清理（随时可做）
