# 性能优化点

> 审查日期: 2026-06-14
> 最后更新: 2026-06-14（#1-#7/#9/#10 已完成）

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

### 3. ✅ `getDashboardData` 同步阻塞主进程（已务实优化）

`src/main/metricsStore.ts:175`：6 次串行 SQL 查询全在主线程同步执行，数据量增大后卡 UI。（注：原 7 次，已删 recentTotal 冗余查询降为 6 次；加上 main.ts wrapper 的 3 个 catalog 查询，稳态实际为 6 次，因 catalog 已缓存。）

**方案**：考虑 `worker_threads` 或拆分为增量查询。

**完成**：务实优化（删冗余查询 `cabdc7a` + catalog 缓存 `67214ef`），单次 IPC 稳态从 10 次查询降到 6 次。`worker_threads` / 换 `better-sqlite3` 列为**未来评估项**：当前单用户数据量（10³–10⁵ 行，timestamp 索引）下单次查询成本不构成瓶颈，架构投入不划算。触发阈值：数据量 >10⁵ 行或单次查询 >50ms。

### 4. ~~SQLite 未开 WAL~~（已放弃）

实测 `node-sqlite3-wasm` 的 wasm 构建不支持 WAL（`PRAGMA journal_mode=WAL` 被静默降级为 `memory`）。本项目 SQLite 单连接使用，WAL 收益有限，故放弃。若未来切换 native 驱动可重新评估。

## 中优先级

### 5. ✅ `recentTotal` 冗余查询（已完成）

`src/main/metricsStore.ts`：原单独 `COUNT(*)` 查询，与 `todaySummary` 的 `COUNT(*)` WHERE 完全相同。已删除，复用 `todaySummary.requestCount`。commit `cabdc7a`。

### 6. ✅ App.tsx render body 未 memo 化计算（已完成）

`src/renderer/App.tsx`：`chartData`（含 `filledTrends`/`axisLabelOpts` 内聚）已 `useMemo` 化，tooltip hover 不再触发派生数据重算。`chartTicks` 原已 memo。commit `31ab857`。

### 7. ✅ 全量刷新无增量更新（已完成）

每次 `metrics:dashboard-updated` 都拉取全部数据（summary + recent 列表 + ranking + trends + options）。高频更新时大部分数据未变。

**完成**：拆分 IPC 通道（`metrics:get-summary` / `metrics:get-recent` / `metrics:get-ranking` / `metrics:get-trends`），renderer 智能刷新策略：summary+recent 每次事件刷新，ranking+trends 每 5 次刷新，filter 变化时全量刷新。

## 低优先级

### 8. JSONL compact 过于激进

`src/main/main.ts:259-261`：每次 import 有新数据就重写整个 JSONL 文件（offset 归零 + 文件截断）。积压时 IO 开销大。

**方案**：设阈值（如已消费 > 50% 或文件 > 1MB 才 compact）。

### 9. ✅ 模块级全局可变状态（已完成）

`src/main/main.ts`：原 11 个 `let` 模块变量，已收敛到单个 `AppState` 对象，统一通过 `state.` 前缀访问。

### 10. ✅ 趋势 SQL 字符串插值（已完成）

`src/main/metricsStore.ts`：`trendIntervalSeconds` 直接插值到 SQL。已添加 `VALID_TREND_INTERVALS` allowlist 和 `assertValidTrendInterval` 校验函数，确保插值输入受控。SQLite 不支持 GROUP BY 表达式绑定参数，故保留插值 + 校验模式。
