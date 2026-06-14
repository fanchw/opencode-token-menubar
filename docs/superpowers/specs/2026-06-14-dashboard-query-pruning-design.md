# Dashboard Query Pruning Design

## Goal

降低 `getDashboardData` 单次调用的 SQL 查询成本。上一轮 ingest 批量合并已把**调用频率**从「每事件」降到「每 200ms」；本轮聚焦**单次成本**。

## Background

探索发现每次 dashboard IPC 实际执行 **10 次同步 SQL**（非文档早先记录的 7 次）：
- `metricsStore.getDashboardData()` 内 7 次（summary / recent / recentTotal / modelRanking / trends / providerOptions / modelOptions）
- `main.ts` wrapper 内 3 次 catalog 查询（`getCatalogProviders` / `getCatalogModels` / `getModelProviderMap`）

数据量评估：单用户菜单栏 app，每天几百到几千行，索引在 `timestamp` 上。即使 10⁶ 行，单查询也是个位数 ms。故 worker_threads / 换 better-sqlite3 属过度工程。

## Design

务实三连击，零架构改动：

### 1. 删除 recentTotal 冗余查询

`recentTotal`（`SELECT COUNT(*) ... WHERE dashboardFilters`）与 `todaySummary.requestCount`（`SELECT COUNT(*) ... WHERE dashboardFilters`）用**完全相同的 WHERE 子句**，结果恒等。直接复用 `todaySummary.requestCount`。

- `getDashboardData` 内部查询数：7 → 6

### 2. Catalog 查询内存缓存

`getCatalogProviders` / `getCatalogModels` / `getModelProviderMap` 三个无参数全量查询加内存缓存：
- getter 命中缓存直接返回，否则查询后填入
- `upsertCatalog`（被 `insertEvents` / `syncCatalog` 调用）写入时标记缓存全部失效（置 null）
- `close()` 清空缓存

注：`getModelProviders(model)` / `getModelsForProviders(list)` 是参数化查询，不缓存（参数组合多，缓存命中率低）。

- 稳态（无写入）wrapper 内 catalog 查询：3 → 0

### 3. Renderer chartData useMemo

`chartData`（含 `filledTrends` + `axisLabelOpts` 派生）包进 `useMemo`，依赖 `[dashboard?.hourlyTrends, intervalSec, filters.start, filters.end, timezone, axisLabelOpts]`。

- tooltip hover 等不改变依赖的 state 变化不再触发派生数据重算

## Data Flow After Optimization

```
IPC: metrics:get-dashboard-data
  ├─ store.getDashboardData()       // 6 次 SQL (原 7, 删 recentTotal)
  │    ├─ todaySummary (含 requestCount, 复用为 recentTotal)
  │    ├─ recent (分页)
  │    ├─ modelRanking
  │    ├─ hourlyTrends
  │    ├─ providerOptions
  │    └─ modelOptions
  └─ wrapper catalog 查询           // 稳态 0 次 (全命中缓存)
       ├─ getCatalogProviders()    [cache]
       ├─ getCatalogModels()       [cache]
       └─ getModelProviderMap()    [cache]

写入路径 (insertEvents / syncCatalog)
  └─ upsertCatalog() → catalogCache = null (失效)
       └─ 下次 getter 重填

renderer
  └─ chartData = useMemo(...)        // hover 不触发重算
```

## Query Count Summary

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| getDashboardData 内部 | 7 | 6 |
| wrapper catalog（稳态） | 3 | 0 |
| wrapper catalog（写入后首次） | 3 | 3 |
| **IPC 总计（稳态）** | **10** | **6** |

## Non-Goals

- 不引入 worker_threads（驱动同步，单连接，当前数据量不值得）
- 不换 better-sqlite3（破坏 WASM 零编译理念，原生优势在当前规模不明显）
- 不拆分 IPC 通道（summary/recent/trends 独立拉取）
- 不改 renderer 端 debounce / in-flight 逻辑（上一轮已够用）

## Future Evaluation

worker_threads / 换 native 驱动的触发阈值：
- 数据量 > 10⁵ 行，或
- 单次 `getDashboardData` 查询 > 50ms，或
- 出现可观测的 UI 卡顿（主线程被查询阻塞）

满足任一条件时，优先评估 worker_threads（保持 WASM 驱动），其次换 better-sqlite3（原生 + WAL）。
