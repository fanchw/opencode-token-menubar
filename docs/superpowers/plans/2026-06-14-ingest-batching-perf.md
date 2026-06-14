# Ingest Batching & Query Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **状态：✅ 已完成（2026-06-14）。** Task 2/3/4 实现并提交（`ecc355b` getTraySummary、`be201bb` EventBuffer、`223fed5` main 集成）。Task 1 WAL 因 `node-sqlite3-wasm` 不支持 WAL 已移除。全量 72 测试通过，build 通过。

**Goal:** 消除高频 ingest 事件导致的写入风暴和查询风暴，通过 200ms 批量合并 + tray 轻量查询将每条事件的 7 次 SQL 查询降为每 200ms 2 次。

**Architecture:** 新增 `EventBuffer` 类负责收集/合并事件并在 timer 到期时回调 flush。`MetricsStore` 新增 `getTraySummary()` 轻量查询方法。`main.ts` 将 `insertLocalMetric` 改为 buffer 入口，flush 回调中批量写入 + 更新 tray + 广播。

> **WAL 已剔除：** 实测 `node-sqlite3-wasm` 的 wasm 构建不支持 WAL（`PRAGMA journal_mode=WAL` 被静默降级为 `memory`）。本项目 SQLite 为单连接使用，WAL 收益有限，故从计划中移除。

**Tech Stack:** Electron, TypeScript, Vitest, node-sqlite3-wasm.

**Spec:** `docs/superpowers/specs/2026-06-14-ingest-batching-perf-design.md`

---

## File Structure

- Modify `src/main/metricsStore.ts` — 新增 `TraySummary` 接口、`getTraySummary()` 方法。
- Modify `src/main/metricsStore.test.ts` — 新增 `getTraySummary` 测试。
- Create `src/main/eventBuffer.ts` — 纯逻辑的 EventBuffer 类，可独立测试。
- Create `src/main/eventBuffer.test.ts` — EventBuffer 的全部行为测试。
- Modify `src/main/main.ts` — 创建 EventBuffer 实例、改写 `insertLocalMetric` 和 `updateTrayTitle`、退出时 flush。

---

## ~~Task 1: SQLite WAL Mode~~ (已移除)

`node-sqlite3-wasm` 不支持 WAL。详见 Plan 头部说明。原 Task 2-4 顺次前移。

---

## Task 2: Tray Summary Lightweight Query

**Files:**
- Modify: `src/main/metricsStore.ts`
- Modify: `src/main/metricsStore.test.ts`

- [x] **Step 1: Write failing getTraySummary tests**

在 `src/main/metricsStore.test.ts` 的 `describe("MetricsStore", ...)` 块末尾添加三个测试：

```ts
  test("getTraySummary returns null speed and zero tokens for empty store", () => {
    const metricsStore = createStore();
    const summary = metricsStore.getTraySummary(
      "2026-06-11T00:00:00.000Z",
      "2026-06-12T00:00:00.000Z",
    );
    expect(summary).toEqual({ latestSpeed: null, totalTokens: 0 });
  });

  test("getTraySummary returns latest speed and total tokens within range", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);
    const summary = metricsStore.getTraySummary(
      "2026-06-11T00:00:00.000Z",
      "2026-06-12T00:00:00.000Z",
    );
    expect(summary).toEqual({ latestSpeed: 25, totalTokens: 500 });
  });

  test("getTraySummary returns null speed when no data in range", () => {
    const metricsStore = createStore();
    metricsStore.insertEvents(baseEvents);
    const summary = metricsStore.getTraySummary(
      "2026-06-12T00:00:00.000Z",
      "2026-06-13T00:00:00.000Z",
    );
    expect(summary).toEqual({ latestSpeed: null, totalTokens: 0 });
  });
```

- [x] **Step 2: Run tests to verify they fail**

Run: `bun run test src/main/metricsStore.test.ts -t "getTraySummary"`

Expected: FAIL — `getTraySummary` is not defined / does not exist on MetricsStore.

- [x] **Step 3: Add TraySummary interface and getTraySummary method**

在 `src/main/metricsStore.ts` 中，`DashboardQuery` 接口之后添加：

```ts
export interface TraySummary {
  latestSpeed: number | null;
  totalTokens: number;
}
```

在 `getDashboardData()` 方法之后、`close()` 方法之前添加：

```ts
  getTraySummary(start: string, end: string): TraySummary {
    const latest = this.database.get(
      `
        SELECT speed FROM requests
        WHERE timestamp >= ? AND timestamp < ?
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      [start, end],
    ) as { speed: number | null } | undefined;

    const summary = this.database.get(
      `
        SELECT COALESCE(SUM(tokens), 0) AS totalTokens
        FROM requests
        WHERE timestamp >= ? AND timestamp < ?
      `,
      [start, end],
    ) as { totalTokens: number | null } | undefined;

    return {
      latestSpeed: latest?.speed ?? null,
      totalTokens: summary?.totalTokens ?? 0,
    };
  }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bun run test src/main/metricsStore.test.ts -t "getTraySummary"`

Expected: All 3 tests PASS

- [x] **Step 5: Run all metricsStore tests to verify no regression**

Run: `bun run test src/main/metricsStore.test.ts`

Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add src/main/metricsStore.ts src/main/metricsStore.test.ts
git commit -m "feat: 新增 getTraySummary 轻量查询方法"
```

---

## Task 3: EventBuffer Module

**Files:**
- Create: `src/main/eventBuffer.ts`
- Create: `src/main/eventBuffer.test.ts`

- [x] **Step 1: Write failing EventBuffer tests**

创建 `src/main/eventBuffer.test.ts`：

```ts
import { afterEach, describe, expect, test, vi } from "vitest";

import { EventBuffer } from "./eventBuffer.js";
import type { MetricEvent } from "../shared/metrics.js";

const testEvent: MetricEvent = {
  id: "evt-1",
  timestamp: "2026-06-14T10:00:00.000Z",
  provider: "anthropic",
  model: "claude-sonnet-4",
  inputTokens: 100,
  outputTokens: 50,
  cacheTokens: 0,
  totalTokens: 150,
  durationMs: 3000,
  tokensPerSecond: 50,
  firstTokenLatencyMs: null,
};

describe("EventBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("does not flush immediately on push", () => {
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);

    expect(onFlush).not.toHaveBeenCalled();
    expect(buffer.size).toBe(1);
  });

  test("flushes after flushMs", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([testEvent]);
    expect(buffer.size).toBe(0);
  });

  test("coalesces multiple pushes into single flush", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    const e1 = { ...testEvent, id: "e1" };
    const e2 = { ...testEvent, id: "e2" };
    const e3 = { ...testEvent, id: "e3" };
    buffer.push(e1);
    buffer.push(e2);
    buffer.push(e3);
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([e1, e2, e3]);
  });

  test("manual flush clears pending timer", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);
    buffer.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  test("flush with empty buffer does not call onFlush", () => {
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.flush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  test("push after flush starts a new timer", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const buffer = new EventBuffer({ flushMs: 200, onFlush });

    buffer.push(testEvent);
    vi.advanceTimersByTime(200);

    const e2 = { ...testEvent, id: "e2" };
    buffer.push(e2);
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(2, [e2]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `bun run test src/main/eventBuffer.test.ts`

Expected: FAIL — `Cannot find module "./eventBuffer.js"` 或类似导入错误。

- [x] **Step 3: Create EventBuffer implementation**

创建 `src/main/eventBuffer.ts`：

```ts
import type { MetricEvent } from "../shared/metrics.js";

export interface EventBufferOptions {
  flushMs: number;
  onFlush: (events: MetricEvent[]) => void;
}

export class EventBuffer {
  private pending: MetricEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: EventBufferOptions) {}

  push(event: MetricEvent): void {
    this.pending.push(event);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.options.flushMs);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    const events = this.pending;
    this.pending = [];
    this.options.onFlush(events);
  }

  get size(): number {
    return this.pending.length;
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bun run test src/main/eventBuffer.test.ts`

Expected: All 6 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/main/eventBuffer.ts src/main/eventBuffer.test.ts
git commit -m "feat: 新增 EventBuffer 批量合并模块"
```

---

## Task 4: Wire Buffer And Tray Into Main

**Files:**
- Modify: `src/main/main.ts`

- [x] **Step 1: Add EventBuffer import**

在 `src/main/main.ts` 顶部导入区（`import { installPlugin } from "./pluginInstaller.js"` 之后）添加：

```ts
import { EventBuffer } from "./eventBuffer.js"
```

- [x] **Step 2: Add eventBuffer module-level variable**

在模块级变量区（`let ingestServer: IngestServerHandle | null = null` 之后）添加：

```ts
let eventBuffer: EventBuffer | null = null
```

- [x] **Step 3: Rewrite updateTrayTitle to use getTraySummary**

将 `src/main/main.ts` 中的 `updateTrayTitle` 函数整体替换为：

```ts
function updateTrayTitle() {
  if (!tray || !store) return

  const { dayStart, dayEnd } = getTodayRange()
  const summary = store.getTraySummary(dayStart, dayEnd)
  if (summary.latestSpeed != null && summary.latestSpeed > 0) {
    tray.setTitle(`OC ${Math.round(summary.latestSpeed)}/s`)
  } else if (summary.totalTokens > 0) {
    tray.setTitle(`OC ${formatTokenUnit(summary.totalTokens)}`)
  } else {
    tray.setTitle("OC")
  }
}
```

- [x] **Step 4: Rewrite insertLocalMetric to use buffer**

将 `src/main/main.ts` 中的 `insertLocalMetric` 函数整体替换为：

```ts
function insertLocalMetric(event: MetricEvent) {
  eventBuffer?.push(event)
}
```

- [x] **Step 5: Create EventBuffer instance in app.whenReady**

在 `app.whenReady().then(async () => {` 中，找到 `store = new MetricsStore(paths.sqlitePath)` 行之后，`syncModelCatalog()` 之前，插入：

```ts
  eventBuffer = new EventBuffer({
    flushMs: 200,
    onFlush: (events) => {
      if (!store) return
      store.insertEvents(events)
      updateTrayTitle()
      broadcastDashboardUpdated()
    },
  })
```

- [x] **Step 6: Add flush before store close in before-quit**

在 `app.on("before-quit", ...)` 的 async cleanup 块中，找到 `try { await ingestServer?.stop() }` 的 `finally` 块之后、`try { store?.close() }` 之前，插入：

```ts
      eventBuffer?.flush()
      eventBuffer = null
```

- [x] **Step 7: Run build to verify compilation**

Run: `bun run build`

Expected: Build succeeds with no TypeScript errors. Vite chunk size warning is OK.

- [x] **Step 8: Run all tests to verify no regression**

Run: `bun run test`

Expected: All tests PASS

- [x] **Step 9: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: ingest 事件批量合并 + tray 轻量查询接入"
```

---

## Verification Checklist

完成后确认：

- [x] `bun run test` 全部通过
- [x] `bun run build` 无编译错误
- [x] `updateTrayTitle` 不再调用 `getDashboardData()`
- [x] `insertLocalMetric` 不再直接调用 `store.insertEvents`
- [x] `before-quit` 在关闭 store 前 flush buffer
