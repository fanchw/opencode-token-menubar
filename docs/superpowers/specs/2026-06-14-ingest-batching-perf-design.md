# Ingest Batching & Query Performance Design

## Goal

消除高频 ingest 事件导致的性能瓶颈：每条 metric 事件触发单独事务写入 + 7 次串行 SQL 查询（tray title）+ 全量 IPC 广播，流式输出时产生写入风暴和查询风暴。

## Problems

1. `updateTrayTitle()` 调用 `getDashboardData()` 跑完整 7 次 SQL 查询，但 tray 只用到 `recent[0].speed` 和 `today.totalTokens`。每个 ingest 事件都调用一次。
2. `insertLocalMetric` 逐条单独事务写入 SQLite，无批量合并。流式响应短时间内几十条事件 = 几十次小事务。
3. `getDashboardData` 7 次串行 SQL 查询同步阻塞主进程，数据量增大后卡 UI。

## Design

### 1. Ingest 事件批量 buffer + flush

`src/main/main.ts` 新增模块级 buffer 和 200ms 定时器调度：

- `insertLocalMetric(event)` 改为只入 buffer：push 到 `pendingEvents[]`，若 timer 未设则启动 200ms 定时器。
- `flushPendingEvents()`：一次事务批量 INSERT → `updateTrayTitle()`（轻量查询）→ `broadcastDashboardUpdated()` → 清空 buffer 和 timer。
- `before-quit` 中同步 flush 一次，确保 pending 事件写入后再关闭 store。
- JSONL 导入路径（`importNewEvents`）保持不变，它本身就是批量写入且频率低。

### 2. Tray 轻量查询

`src/main/metricsStore.ts` 新增 `getTraySummary(start, end)` 方法，只跑 2 条 SQL：

```sql
-- 最近一条请求的 speed
SELECT speed FROM requests
WHERE timestamp >= ? AND timestamp < ?
ORDER BY timestamp DESC LIMIT 1

-- 今日总 token
SELECT COALESCE(SUM(tokens), 0) AS totalTokens
FROM requests WHERE timestamp >= ? AND timestamp < ?
```

`updateTrayTitle()` 改为调用 `store.getTraySummary(dayStart, dayEnd)`，不再走 `getDashboardData()`。返回 `{ latestSpeed: number | null; totalTokens: number }`，tray 标题展示逻辑不变。

### 3. getDashboardData 保持同步

不做代码改动。该查询仍由 renderer 通过 IPC 调用，但调用频率因批量合并而大幅降低：从「每条事件触发一次」变为「每 200ms 至多一次」，再经 renderer debounce 120ms 进一步合并。

### 4. SQLite WAL 模式（已移除）

原计划开 WAL 提升并发，但实测 `node-sqlite3-wasm` 的 wasm 构建不支持 WAL（`PRAGMA journal_mode=WAL` 被静默降级为 `memory`，其余 rollback 模式正常）。本项目 SQLite 为单连接使用，WAL 收益有限，故放弃。若未来切换到 native 驱动（如 `better-sqlite3`）可重新引入。

## Data Flow After Optimization

```
ingest 事件1 ─┐
ingest 事件2 ─┼─► pendingEvents[] ─► [200ms timer] ─► flushPendingEvents()
ingest 事件3 ─┘                                          │
                                                         ├─ store.insertEvents([e1,e2,e3])  // 1 次事务
                                                         ├─ store.getTraySummary()           // 2 条 SQL
                                                         ├─ broadcastDashboardUpdated()       // 1 次 IPC
                                                         └─ 清空 buffer
                                                               │
                                                               ▼
                                                    renderer debounce 120ms
                                                               │
                                                               ▼
                                                    getDashboardData(filters)  // 7 条 SQL，但频率极低
```

## Edge Cases

- **App 退出时有 pending 事件**：`before-quit` 中同步调用 `flushPendingEvents()`，写完后才关闭 store。
- **buffer flush 时又来新事件**：新事件 push 到已清空的 buffer，并设新 timer。flush 是同步的，不会与 ingest 回调交错。
- **窗口不可见时**：仍然 buffer + flush + 写入 SQLite。数据必须持久化，只是 renderer 不刷新（renderer debounce 自然跳过）。

## Testing

- `getTraySummary()`：空表返回 `{ latestSpeed: null, totalTokens: 0 }`；有数据时返回正确的最新 speed 和总量；仅有范围外旧数据时返回 null/0。
- Buffer flush：多事件合并为单次事务；timer 去重（连续 push 只设一个 timer）；flush 后 buffer 和 timer 清空。
- 退出时 flush：pending 事件在 store.close() 前被写入。
- 运行变更模块的聚焦测试，然后 `bun run build` 验证。

## Non-Goals

- 不引入 worker thread 或异步 SQLite。
- 不拆分 IPC 通道（summary/recent/trends 独立拉取）。
- 不做增量更新 / diff-based 推送。
- 不改 JSONL 导入路径的批量逻辑。
- 不改 renderer 端的 debounce 或 memo 优化。
