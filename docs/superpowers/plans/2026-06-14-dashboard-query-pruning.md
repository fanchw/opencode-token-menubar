# Dashboard Query Pruning Implementation Plan

> **状态：✅ 已完成（2026-06-14）。** Task 1/2/3 全部实现并提交。73 测试通过，build 通过。

**Goal:** 降低 `getDashboardData` 单次调用的 SQL 查询成本。稳态 IPC 从 10 次查询降到 6 次（删冗余 + catalog 缓存），renderer hover 不再触发派生重算。

**Architecture:** `MetricsStore` 删除 `recentTotal` 冗余查询、为 catalog 查询加内存缓存（写入失效）。`App.tsx` 的 `chartData` 包进 `useMemo`。

**Tech Stack:** Electron, TypeScript, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-06-14-dashboard-query-pruning-design.md`

---

## Task 1: 删除 recentTotal 冗余查询

**Files:**
- Modify: `src/main/metricsStore.ts` (`getDashboardData`)

- [x] 删除 `recentTotalRow` 查询，复用 `todaySummary.requestCount ?? 0`
- [x] 验证现有测试（`recentTotal` 分页总数断言）通过
- [x] Commit `cabdc7a`: `perf: 删除 recentTotal 冗余查询，复用 todaySummary.requestCount`

---

## Task 2: Catalog 查询内存缓存

**Files:**
- Modify: `src/main/metricsStore.ts`
- Modify: `src/main/metricsStore.test.ts`

- [x] 新增 `catalogCache` 字段（providers/models/modelProviderMap，初值 null）
- [x] 改造 `getCatalogProviders` / `getCatalogModels` / `getModelProviderMap` 命中缓存返回，否则查询后填入
- [x] `upsertCatalog` 写入时标记缓存全部失效
- [x] `close()` 清空缓存
- [x] 新增测试 `caches catalog queries until invalidated by write`（CountingDatabase 注入统计 all 调用次数）
- [x] 全量回归通过
- [x] Commit `67214ef`: `perf: catalog 查询内存缓存（写入失效），稳态 IPC 省 3 次查询`

---

## Task 3: Renderer chartData useMemo

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/main/metricsStore.test.ts`（顺手修 CountingDatabase 类型，用 BindValues 替代 unknown[]）

- [x] `chartData`（含 `filledTrends` + `axisLabelOpts`）包进 `useMemo`，依赖 `[dashboard?.hourlyTrends, intervalSec, filters.start, filters.end, timezone, axisLabelOpts]`
- [x] 修正 CountingDatabase override 类型签名（`BindValues`）
- [x] Build + 全量测试通过
- [x] Commit `31ab857`: `perf: chartData useMemo 化，避免 hover 触发派生数据重算`

---

## Verification Checklist

- [x] `bun run test` 全部通过（73 tests）
- [x] `bun run build` 无编译错误
- [x] `getDashboardData` 内 SQL 查询从 7 降到 6（删 recentTotal）
- [x] 稳态（无写入）IPC 时 catalog 查询 0 次（全命中缓存）
- [x] `chartData` 不在 hover 时重算

---

## Query Count Summary

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| getDashboardData 内部 | 7 | 6 |
| wrapper catalog（稳态） | 3 | 0 |
| **IPC 总计（稳态）** | **10** | **6** |
