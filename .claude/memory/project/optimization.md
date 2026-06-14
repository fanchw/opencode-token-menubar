# 性能优化点

> 审查日期: 2026-06-14
> 最后更新: 2026-06-14（高优先级 1/2/4 已完成）

按影响程度排序。

## 高优先级

### 1. ✅ `updateTrayTitle` 每次调用跑完整 dashboard 查询（已完成）

`src/main/main.ts:176` → `getDashboardData()` 内含 7 次串行 SQL 查询，但 tray 只用到 `recent[0].tokensPerSecond` 和 `today.totalTokens`。

**每个 ingest 事件都调用一次**（`main.ts:275`），流式输出时高频事件会反复执行全量查询。

**方案**：给 tray 单独写轻量查询（只取 recent[0] + today summary），或复用缓存。

**完成**：新增 `MetricsStore.getTraySummary()`（2 条 SQL），`updateTrayTitle()` 改用之。commit `ecc355b`。

### 2. ✅ 每条 metric 事件触发全链路刷新，无批量合并（已完成）

`src/main/main.ts:269-277` `insertLocalMetric`：
- 逐条单独事务写入 SQLite
- 调用 `updateTrayTitle()`（触发完整查询）
- `broadcastDashboardUpdated()`（触发 renderer debounce 120ms 后全量重拉）

流式响应短时间内几十条事件 → 几十次写入 + 几十次查询风暴。

**方案**：ingest 端加 buffer/debounce（如 200ms 窗口），合并写入和刷新。

**完成**：新增 `EventBuffer`（200ms 合并），`insertLocalMetric` 改为 buffer 入口。commit `be201bb` + `223fed5`。

### 3. `getDashboardData` 同步阻塞主进程

`src/main/metricsStore.ts:175`：7 次串行 SQL 查询全在主线程同步执行，数据量增大后卡 UI。

**方案**：考虑 `worker_threads` 或拆分为增量查询。

> 注：本项仅降低频率（批量合并后触发频率大幅下降），未根治同步阻塞。属下一阶段独立工作。

### 4. ~~SQLite 未开 WAL~~（已放弃）

实测 `node-sqlite3-wasm` 的 wasm 构建不支持 WAL（`PRAGMA journal_mode=WAL` 被静默降级为 `memory`）。本项目 SQLite 单连接使用，WAL 收益有限，故放弃。若未来切换 native 驱动可重新评估。

## 中优先级

### 5. `recentTotal` 冗余查询

`src/main/metricsStore.ts:228`：单独 `COUNT(*)` 查询，但 `todaySummary`（:185）已有 `COUNT(*)`，WHERE 条件相同时可合并。

### 6. App.tsx render body 未 memo 化计算

`src/renderer/App.tsx:309-326`：`filledTrends`、`chartData`、`chartTicks` 每次渲染重算，未用 `useMemo`。任一 state 变化（如 tooltip hover）都触发重算。

### 7. 全量刷新无增量更新

每次 `metrics:dashboard-updated` 都拉取全部数据（summary + recent 列表 + ranking + trends + options）。高频更新时大部分数据未变。

**方案**：diff-based 增量推送，或拆分 IPC 通道（summary / recent / trends 独立拉取）。

## 低优先级

### 8. JSONL compact 过于激进

`src/main/main.ts:259-261`：每次 import 有新数据就重写整个 JSONL 文件（offset 归零 + 文件截断）。积压时 IO 开销大。

**方案**：设阈值（如已消费 > 50% 或文件 > 1MB 才 compact）。

### 9. 模块级全局可变状态

`src/main/main.ts:15-24`：10 个 `let` 模块变量（tray, window, store, watcher 等），测试困难。

**方案**：收敛到 AppState 对象或依赖注入。

### 10. 趋势 SQL 字符串插值

`src/main/metricsStore.ts:263`：`trendIntervalSeconds` 直接插值到 SQL。当前值来自固定枚举无注入风险，但模式不佳，可用参数化。
