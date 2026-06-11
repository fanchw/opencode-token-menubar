# OpenCode Token Menubar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS Electron menubar app that installs an OpenCode token metrics plugin and displays token usage, speed, model ranking, and hourly trends from local data.

**Architecture:** The OpenCode plugin writes append-only JSONL events to `~/.config/opencode/token-metrics/events.jsonl`. The Electron main process watches and imports those events into SQLite under the app data directory. The renderer queries dashboard data through IPC and renders summary cards, recent requests, model ranking, trends, and settings.

**Tech Stack:** Electron, Vite, React, TypeScript, Vitest, better-sqlite3, chokidar, Recharts, Node.js filesystem APIs.

---

## File Structure

- Create `package.json`: scripts, dependencies, build metadata.
- Create `tsconfig.json`: shared TypeScript config.
- Create `vite.config.ts`: renderer dev/build and Vitest config.
- Create `index.html`: renderer entry.
- Create `src/shared/metrics.ts`: shared metric event and dashboard types plus normalization helpers.
- Create `src/main/paths.ts`: resolves JSONL, SQLite, plugin, and app paths.
- Create `src/main/pluginInstaller.ts`: installs bundled plugin globally.
- Create `src/main/metricsStore.ts`: SQLite schema, import, and aggregation queries.
- Create `src/main/jsonlImporter.ts`: reads appended JSONL lines and imports normalized events.
- Create `src/main/main.ts`: Electron app lifecycle, tray, popup window, watcher, IPC.
- Create `src/main/preload.ts`: safe IPC bridge.
- Create `src/renderer/App.tsx`: dashboard UI.
- Create `src/renderer/main.tsx`: React entry.
- Create `src/renderer/styles.css`: dashboard styling.
- Create `plugin/token-metrics.ts`: bundled OpenCode plugin template.
- Create `README.md`: development, installation, and restart instructions.
- Create tests under `src/**/*.test.ts` for normalization, SQLite aggregation, installer path handling, and JSONL import.

## Task 1: Scaffold Electron React TypeScript Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main/main.ts`
- Create: `src/main/preload.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`
- Create: `README.md`

- [ ] **Step 1: Create project package file**

Create `package.json`:

```json
{
  "name": "opencode-token-menubar",
  "version": "0.1.0",
  "private": true,
  "description": "macOS menubar dashboard for OpenCode token metrics",
  "main": "dist/main/main.js",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.json",
    "build": "bun run build:renderer && bun run build:main",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "electron .",
    "dev:app": "bun run build:main && ELECTRON_RENDERER_URL=http://127.0.0.1:5173 electron ."
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "better-sqlite3": "latest",
    "chokidar": "latest",
    "electron": "latest",
    "react": "latest",
    "react-dom": "latest",
    "recharts": "latest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  },
  "build": {
    "appId": "ai.opencode.token-menubar",
    "productName": "OpenCode Token Menubar",
    "mac": {
      "category": "public.app-category.developer-tools"
    }
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 3: Create Vite config**

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
  },
  test: {
    globals: true,
    environment: "node",
  },
})
```

- [ ] **Step 4: Create renderer HTML entry**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenCode Token Menubar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create minimal Electron main process**

Create `src/main/main.ts`:

```ts
import { app, BrowserWindow, Tray } from "electron"
import path from "node:path"

let tray: Tray | null = null
let window: BrowserWindow | null = null

function createWindow() {
  window = new BrowserWindow({
    width: 520,
    height: 680,
    show: false,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist/main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"))
  }
}

function toggleWindow() {
  if (!window || !tray) return
  if (window.isVisible()) {
    window.hide()
    return
  }

  const trayBounds = tray.getBounds()
  const windowBounds = window.getBounds()
  window.setPosition(
    Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2),
    Math.round(trayBounds.y + trayBounds.height + 6),
    false,
  )
  window.show()
}

app.whenReady().then(() => {
  createWindow()
  tray = new Tray(path.join(app.getAppPath(), "assets/tray-iconTemplate.png"))
  tray.setToolTip("OpenCode Token Menubar")
  tray.setTitle("OpenCode")
  tray.on("click", toggleWindow)
})

app.on("window-all-closed", (event) => {
  event.preventDefault()
})
```

- [ ] **Step 6: Create preload placeholder**

Create `src/main/preload.ts`:

```ts
import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("tokenMetrics", {})
```

- [ ] **Step 7: Create minimal React entry and UI**

Create `src/renderer/main.tsx`:

```tsx
import React from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./styles.css"

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Create `src/renderer/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">OpenCode</p>
        <h1>Token Metrics</h1>
      </header>
      <section className="empty-card">
        <strong>No metrics yet</strong>
        <span>Install the plugin, restart OpenCode, then run a model request.</span>
      </section>
    </main>
  )
}
```

Create `src/renderer/styles.css`:

```css
:root {
  color: #f8fafc;
  background: #0f172a;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
  padding: 22px;
  background: radial-gradient(circle at top left, #1e3a8a 0, transparent 34%), #0f172a;
}

.eyebrow {
  margin: 0 0 4px;
  color: #93c5fd;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 20px;
  font-size: 28px;
}

.empty-card {
  display: grid;
  gap: 8px;
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.72);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
}

.empty-card span {
  color: #cbd5e1;
}
```

- [ ] **Step 8: Create README**

Create `README.md`:

```md
# OpenCode Token Menubar

macOS menubar app for viewing OpenCode token usage and token speed.

## Development

```bash
bun install
bun run build
bun run dev
```

In another terminal:

```bash
bun run dev:app
```

## OpenCode Plugin

The app installs the bundled plugin globally to:

```text
~/.config/opencode/plugin/token-metrics.ts
```

Restart OpenCode after installing or reinstalling the plugin.
```

- [ ] **Step 9: Run build to verify scaffold**

Run: `bun install && bun run build`

Expected: dependencies install and both renderer and main TypeScript builds complete.

- [ ] **Step 10: Commit scaffold**

Run only if inside a git repository:

```bash
git add package.json tsconfig.json vite.config.ts index.html src README.md
git commit -m "feat: 初始化 OpenCode token 状态栏项目"
```

## Task 2: Add Shared Metric Types and Normalization

**Files:**
- Create: `src/shared/metrics.ts`
- Create: `src/shared/metrics.test.ts`

- [ ] **Step 1: Write failing tests for normalization**

Create `src/shared/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { normalizeMetricEvent } from "./metrics"

describe("normalizeMetricEvent", () => {
  it("normalizes a complete event", () => {
    const event = normalizeMetricEvent({
      id: "req-1",
      timestamp: "2026-06-11T08:30:00.000Z",
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      durationMs: 4200,
      tokensPerSecond: 190.48,
    })

    expect(event).toEqual({
      id: "req-1",
      timestamp: "2026-06-11T08:30:00.000Z",
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      durationMs: 4200,
      tokensPerSecond: 190.48,
    })
  })

  it("defaults missing optional fields", () => {
    const event = normalizeMetricEvent({ id: "req-2" })

    expect(event.id).toBe("req-2")
    expect(event.provider).toBe("unknown")
    expect(event.model).toBe("unknown")
    expect(event.inputTokens).toBe(0)
    expect(event.outputTokens).toBe(0)
    expect(event.totalTokens).toBe(0)
    expect(event.durationMs).toBe(0)
    expect(event.tokensPerSecond).toBe(0)
    expect(new Date(event.timestamp).toString()).not.toBe("Invalid Date")
  })

  it("derives total tokens and tokens per second when possible", () => {
    const event = normalizeMetricEvent({
      id: "req-3",
      inputTokens: 25,
      outputTokens: 75,
      durationMs: 2000,
    })

    expect(event.totalTokens).toBe(100)
    expect(event.tokensPerSecond).toBe(50)
  })

  it("returns null for missing id", () => {
    expect(normalizeMetricEvent({ provider: "openai" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/shared/metrics.test.ts`

Expected: FAIL because `src/shared/metrics.ts` does not exist.

- [ ] **Step 3: Implement shared metric types and normalization**

Create `src/shared/metrics.ts`:

```ts
export type RawMetricEvent = {
  id?: unknown
  timestamp?: unknown
  provider?: unknown
  model?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  totalTokens?: unknown
  durationMs?: unknown
  tokensPerSecond?: unknown
}

export type MetricEvent = {
  id: string
  timestamp: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
  tokensPerSecond: number
}

export type TodaySummary = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  averageTokensPerSecond: number
}

export type RecentRequest = MetricEvent

export type ModelRankingRow = {
  provider: string
  model: string
  requestCount: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  averageTokensPerSecond: number
}

export type HourlyTrendRow = {
  hour: string
  totalTokens: number
  averageTokensPerSecond: number
}

export type DashboardData = {
  today: TodaySummary
  recent: RecentRequest[]
  modelRanking: ModelRankingRow[]
  hourlyTrends: HourlyTrendRow[]
  importErrors: number
  pluginInstalled: boolean
  paths: {
    jsonl: string
    sqlite: string
    plugin: string
  }
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

export function normalizeMetricEvent(raw: RawMetricEvent): MetricEvent | null {
  const id = stringOrDefault(raw.id, "")
  if (!id) return null

  const inputTokens = numberOrZero(raw.inputTokens)
  const outputTokens = numberOrZero(raw.outputTokens)
  const durationMs = numberOrZero(raw.durationMs)
  const providedTotal = numberOrZero(raw.totalTokens)
  const totalTokens = providedTotal || inputTokens + outputTokens
  const providedSpeed = numberOrZero(raw.tokensPerSecond)
  const tokensPerSecond = providedSpeed || (durationMs > 0 ? totalTokens / (durationMs / 1000) : 0)
  const timestamp = stringOrDefault(raw.timestamp, new Date().toISOString())

  return {
    id,
    timestamp,
    provider: stringOrDefault(raw.provider, "unknown"),
    model: stringOrDefault(raw.model, "unknown"),
    inputTokens,
    outputTokens,
    totalTokens,
    durationMs,
    tokensPerSecond,
  }
}
```

- [ ] **Step 4: Run normalization tests**

Run: `bun run test src/shared/metrics.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit shared metric model**

Run only if inside a git repository:

```bash
git add src/shared/metrics.ts src/shared/metrics.test.ts
git commit -m "feat: 添加 token 指标标准化模型"
```

## Task 3: Add SQLite Metrics Store

**Files:**
- Create: `src/main/metricsStore.ts`
- Create: `src/main/metricsStore.test.ts`

- [ ] **Step 1: Write failing SQLite aggregation tests**

Create `src/main/metricsStore.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { MetricsStore } from "./metricsStore"

let tempDir: string | null = null

function createStore() {
  tempDir = mkdtempSync(path.join(tmpdir(), "metrics-store-"))
  return new MetricsStore(path.join(tempDir, "metrics.db"))
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe("MetricsStore", () => {
  it("imports events idempotently and returns dashboard aggregations", () => {
    const store = createStore()
    store.insertEvents([
      {
        id: "req-1",
        timestamp: "2026-06-11T08:10:00.000Z",
        provider: "openai",
        model: "gpt-4.1",
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        durationMs: 1000,
        tokensPerSecond: 30,
      },
      {
        id: "req-1",
        timestamp: "2026-06-11T08:10:00.000Z",
        provider: "openai",
        model: "gpt-4.1",
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        durationMs: 1000,
        tokensPerSecond: 30,
      },
      {
        id: "req-2",
        timestamp: "2026-06-11T09:00:00.000Z",
        provider: "anthropic",
        model: "claude-sonnet",
        inputTokens: 5,
        outputTokens: 15,
        totalTokens: 20,
        durationMs: 2000,
        tokensPerSecond: 10,
      },
    ])

    const dashboard = store.getDashboardData({
      dayStart: "2026-06-11T00:00:00.000Z",
      dayEnd: "2026-06-12T00:00:00.000Z",
      recentLimit: 10,
    })

    expect(dashboard.today).toEqual({
      totalTokens: 50,
      inputTokens: 15,
      outputTokens: 35,
      averageTokensPerSecond: 20,
    })
    expect(dashboard.recent.map((row) => row.id)).toEqual(["req-2", "req-1"])
    expect(dashboard.modelRanking).toHaveLength(2)
    expect(dashboard.hourlyTrends).toEqual([
      { hour: "08", totalTokens: 30, averageTokensPerSecond: 30 },
      { hour: "09", totalTokens: 20, averageTokensPerSecond: 10 },
    ])

    store.close()
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/main/metricsStore.test.ts`

Expected: FAIL because `metricsStore.ts` does not exist.

- [ ] **Step 3: Implement SQLite store**

Create `src/main/metricsStore.ts`:

```ts
import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import path from "node:path"
import type { DashboardData, MetricEvent } from "../shared/metrics"

export type DashboardQuery = {
  dayStart: string
  dayEnd: string
  recentLimit: number
}

export class MetricsStore {
  private db: Database.Database

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new Database(databasePath)
    this.db.pragma("journal_mode = WAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        tokens_per_second REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_provider_model ON requests(provider, model);
    `)
  }

  insertEvents(events: MetricEvent[]) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO requests (
        id, timestamp, provider, model, input_tokens, output_tokens, total_tokens, duration_ms, tokens_per_second
      ) VALUES (
        @id, @timestamp, @provider, @model, @inputTokens, @outputTokens, @totalTokens, @durationMs, @tokensPerSecond
      )
    `)
    const transaction = this.db.transaction((items: MetricEvent[]) => {
      for (const item of items) insert.run(item)
    })
    transaction(events)
  }

  getDashboardData(query: DashboardQuery): Omit<DashboardData, "importErrors" | "pluginInstalled" | "paths"> {
    const range = { dayStart: query.dayStart, dayEnd: query.dayEnd }
    const today = this.db
      .prepare(`
        SELECT
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(SUM(input_tokens), 0) AS inputTokens,
          COALESCE(SUM(output_tokens), 0) AS outputTokens,
          COALESCE(AVG(tokens_per_second), 0) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= @dayStart AND timestamp < @dayEnd
      `)
      .get(range) as Omit<DashboardData["today"], never>

    const recent = this.db
      .prepare(`
        SELECT
          id,
          timestamp,
          provider,
          model,
          input_tokens AS inputTokens,
          output_tokens AS outputTokens,
          total_tokens AS totalTokens,
          duration_ms AS durationMs,
          tokens_per_second AS tokensPerSecond
        FROM requests
        ORDER BY timestamp DESC
        LIMIT @recentLimit
      `)
      .all({ recentLimit: query.recentLimit }) as DashboardData["recent"]

    const modelRanking = this.db
      .prepare(`
        SELECT
          provider,
          model,
          COUNT(*) AS requestCount,
          SUM(total_tokens) AS totalTokens,
          SUM(input_tokens) AS inputTokens,
          SUM(output_tokens) AS outputTokens,
          AVG(tokens_per_second) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= @dayStart AND timestamp < @dayEnd
        GROUP BY provider, model
        ORDER BY totalTokens DESC
      `)
      .all(range) as DashboardData["modelRanking"]

    const hourlyTrends = this.db
      .prepare(`
        SELECT
          strftime('%H', timestamp) AS hour,
          SUM(total_tokens) AS totalTokens,
          AVG(tokens_per_second) AS averageTokensPerSecond
        FROM requests
        WHERE timestamp >= @dayStart AND timestamp < @dayEnd
        GROUP BY hour
        ORDER BY hour ASC
      `)
      .all(range) as DashboardData["hourlyTrends"]

    return { today, recent, modelRanking, hourlyTrends }
  }

  close() {
    this.db.close()
  }
}
```

- [ ] **Step 4: Run SQLite tests**

Run: `bun run test src/main/metricsStore.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit SQLite store**

Run only if inside a git repository:

```bash
git add src/main/metricsStore.ts src/main/metricsStore.test.ts
git commit -m "feat: 添加 token 指标本地存储"
```

## Task 4: Add JSONL Importer and Path Resolution

**Files:**
- Create: `src/main/paths.ts`
- Create: `src/main/jsonlImporter.ts`
- Create: `src/main/jsonlImporter.test.ts`

- [ ] **Step 1: Write failing JSONL importer tests**

Create `src/main/jsonlImporter.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readJsonlEvents } from "./jsonlImporter"

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe("readJsonlEvents", () => {
  it("reads valid events and counts invalid lines", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "jsonl-import-"))
    const filePath = path.join(tempDir, "events.jsonl")
    writeFileSync(
      filePath,
      [
        JSON.stringify({ id: "req-1", provider: "openai", inputTokens: 1, outputTokens: 2 }),
        "not-json",
        JSON.stringify({ provider: "missing-id" }),
        "",
      ].join("\n"),
    )

    const result = readJsonlEvents(filePath)

    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.id).toBe("req-1")
    expect(result.events[0]?.totalTokens).toBe(3)
    expect(result.errors).toBe(2)
  })

  it("returns an empty result when file is missing", () => {
    const result = readJsonlEvents("/path/that/does/not/exist.jsonl")

    expect(result).toEqual({ events: [], errors: 0 })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/main/jsonlImporter.test.ts`

Expected: FAIL because `jsonlImporter.ts` does not exist.

- [ ] **Step 3: Implement path resolver**

Create `src/main/paths.ts`:

```ts
import { app } from "electron"
import os from "node:os"
import path from "node:path"

export type AppPaths = {
  jsonlPath: string
  sqlitePath: string
  pluginPath: string
  bundledPluginPath: string
}

export function resolveAppPaths(appPath = app.getAppPath(), userDataPath = app.getPath("userData")): AppPaths {
  const home = os.homedir()
  return {
    jsonlPath: path.join(home, ".config/opencode/token-metrics/events.jsonl"),
    sqlitePath: path.join(userDataPath, "metrics.db"),
    pluginPath: path.join(home, ".config/opencode/plugin/token-metrics.ts"),
    bundledPluginPath: path.join(appPath, "plugin/token-metrics.ts"),
  }
}
```

- [ ] **Step 4: Implement JSONL reader**

Create `src/main/jsonlImporter.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { normalizeMetricEvent, type MetricEvent, type RawMetricEvent } from "../shared/metrics"

export type JsonlReadResult = {
  events: MetricEvent[]
  errors: number
}

export function readJsonlEvents(filePath: string): JsonlReadResult {
  if (!existsSync(filePath)) return { events: [], errors: 0 }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/)
  const events: MetricEvent[] = []
  let errors = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const normalized = normalizeMetricEvent(JSON.parse(trimmed) as RawMetricEvent)
      if (normalized) {
        events.push(normalized)
      } else {
        errors += 1
      }
    } catch {
      errors += 1
    }
  }

  return { events, errors }
}
```

- [ ] **Step 5: Run JSONL tests**

Run: `bun run test src/main/jsonlImporter.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit importer**

Run only if inside a git repository:

```bash
git add src/main/paths.ts src/main/jsonlImporter.ts src/main/jsonlImporter.test.ts
git commit -m "feat: 添加 JSONL 指标导入"
```

## Task 5: Add Plugin Installer and Bundled OpenCode Plugin

**Files:**
- Create: `plugin/token-metrics.ts`
- Create: `src/main/pluginInstaller.ts`
- Create: `src/main/pluginInstaller.test.ts`

- [ ] **Step 1: Write failing plugin installer tests**

Create `src/main/pluginInstaller.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { installPlugin } from "./pluginInstaller"

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe("installPlugin", () => {
  it("copies bundled plugin to global plugin path", () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "plugin-install-"))
    const source = path.join(tempDir, "source.ts")
    const target = path.join(tempDir, ".config/opencode/plugin/token-metrics.ts")
    writeFileSync(source, "export default async () => ({})\n")

    const result = installPlugin({ sourcePath: source, targetPath: target })

    expect(result.installed).toBe(true)
    expect(result.targetPath).toBe(target)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, "utf8")).toContain("export default")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test src/main/pluginInstaller.test.ts`

Expected: FAIL because `pluginInstaller.ts` does not exist.

- [ ] **Step 3: Implement plugin installer**

Create `src/main/pluginInstaller.ts`:

```ts
import { copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"

export type InstallPluginInput = {
  sourcePath: string
  targetPath: string
}

export type InstallPluginResult = {
  installed: true
  targetPath: string
}

export function installPlugin(input: InstallPluginInput): InstallPluginResult {
  mkdirSync(path.dirname(input.targetPath), { recursive: true })
  copyFileSync(input.sourcePath, input.targetPath)
  return { installed: true, targetPath: input.targetPath }
}
```

- [ ] **Step 4: Add bundled OpenCode plugin**

Create `plugin/token-metrics.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin"

type PendingRequest = {
  startedAt: number
  provider: string
  model: string
}

const pending = new Map<string, PendingRequest>()

function asString(value: unknown, fallback = "unknown") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function eventId(input: any) {
  return asString(input?.id ?? input?.requestID ?? input?.messageID ?? input?.sessionID, `${Date.now()}-${Math.random()}`)
}

function tokenUsage(input: any) {
  const usage = input?.usage ?? input?.tokens ?? input?.response?.usage ?? {}
  const inputTokens = asNumber(usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens)
  const outputTokens = asNumber(usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens)
  const totalTokens = asNumber(usage.totalTokens ?? usage.total_tokens) || inputTokens + outputTokens
  return { inputTokens, outputTokens, totalTokens }
}

export default (async ({ $ }) => {
  const metricsDir = `${process.env.HOME}/.config/opencode/token-metrics`
  const metricsFile = `${metricsDir}/events.jsonl`

  async function appendMetric(metric: Record<string, unknown>) {
    await $`mkdir -p ${metricsDir}`
    await $`node -e ${`
      const fs = require('fs');
      const file = process.argv[1];
      const metric = JSON.parse(process.argv[2]);
      fs.appendFileSync(file, JSON.stringify(metric) + '\\n');
    `} ${metricsFile} ${JSON.stringify(metric)}`
  }

  return {
    event: async (input: any) => {
      const type = asString(input?.type, "")
      if (type === "llm.start" || type === "message.start") {
        pending.set(eventId(input), {
          startedAt: Date.now(),
          provider: asString(input?.provider ?? input?.properties?.provider),
          model: asString(input?.model ?? input?.properties?.model),
        })
        return
      }

      if (type !== "llm.stop" && type !== "message.stop") return

      const id = eventId(input)
      const started = pending.get(id)
      const durationMs = started ? Date.now() - started.startedAt : 0
      pending.delete(id)

      const usage = tokenUsage(input)
      const tokensPerSecond = durationMs > 0 ? usage.totalTokens / (durationMs / 1000) : 0

      await appendMetric({
        id,
        timestamp: new Date().toISOString(),
        provider: asString(input?.provider ?? input?.properties?.provider, started?.provider ?? "unknown"),
        model: asString(input?.model ?? input?.properties?.model, started?.model ?? "unknown"),
        ...usage,
        durationMs,
        tokensPerSecond,
      })
    },
  }
}) satisfies Plugin
```

- [ ] **Step 5: Run installer tests**

Run: `bun run test src/main/pluginInstaller.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify plugin syntax**

Run: `bun build plugin/token-metrics.ts --external @opencode-ai/plugin --outdir /tmp/opencode-token-plugin-check`

Expected: build succeeds.

- [ ] **Step 7: Commit installer and plugin**

Run only if inside a git repository:

```bash
git add plugin/token-metrics.ts src/main/pluginInstaller.ts src/main/pluginInstaller.test.ts
git commit -m "feat: 添加 OpenCode 插件安装器"
```

## Task 6: Wire Electron Main Process, IPC, Watcher, and Tray Title

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/shared/metrics.ts`

- [ ] **Step 1: Add preload API types**

Modify `src/shared/metrics.ts` by appending:

```ts
export type TokenMetricsApi = {
  getDashboardData: () => Promise<DashboardData>
  installPlugin: () => Promise<{ installed: true; targetPath: string }>
}

declare global {
  interface Window {
    tokenMetrics: TokenMetricsApi
  }
}
```

- [ ] **Step 2: Expose IPC API in preload**

Replace `src/main/preload.ts` with:

```ts
import { contextBridge, ipcRenderer } from "electron"
import type { TokenMetricsApi } from "../shared/metrics"

const api: TokenMetricsApi = {
  getDashboardData: () => ipcRenderer.invoke("metrics:get-dashboard-data"),
  installPlugin: () => ipcRenderer.invoke("plugin:install"),
}

contextBridge.exposeInMainWorld("tokenMetrics", api)
```

- [ ] **Step 3: Replace main process with data wiring**

Replace `src/main/main.ts` with:

```ts
import chokidar from "chokidar"
import { app, BrowserWindow, ipcMain, nativeImage, Tray } from "electron"
import { existsSync } from "node:fs"
import path from "node:path"
import { readJsonlEvents } from "./jsonlImporter"
import { MetricsStore } from "./metricsStore"
import { resolveAppPaths } from "./paths"
import { installPlugin } from "./pluginInstaller"

let tray: Tray | null = null
let window: BrowserWindow | null = null
let store: MetricsStore | null = null
let importErrors = 0
let importing = false

function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { dayStart: start.toISOString(), dayEnd: end.toISOString() }
}

function createWindow() {
  window = new BrowserWindow({
    width: 560,
    height: 720,
    show: false,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist/main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"))
  }
}

function toggleWindow() {
  if (!window || !tray) return
  if (window.isVisible()) {
    window.hide()
    return
  }
  const trayBounds = tray.getBounds()
  const windowBounds = window.getBounds()
  window.setPosition(
    Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2),
    Math.round(trayBounds.y + trayBounds.height + 6),
    false,
  )
  window.show()
}

function importJsonl() {
  if (!store || importing) return
  importing = true
  try {
    const paths = resolveAppPaths(app.getAppPath(), app.getPath("userData"))
    const result = readJsonlEvents(paths.jsonlPath)
    importErrors += result.errors
    store.insertEvents(result.events)
    const data = store.getDashboardData({ ...todayRange(), recentLimit: 20 })
    const latest = data.recent[0]
    if (latest && latest.tokensPerSecond > 0) {
      tray?.setTitle(`${Math.round(latest.tokensPerSecond)} tok/s`)
    } else if (data.today.totalTokens > 0) {
      tray?.setTitle(`${Math.round(data.today.totalTokens / 100) / 10}K tok`)
    } else {
      tray?.setTitle("OpenCode")
    }
    window?.webContents.send("metrics:updated")
  } finally {
    importing = false
  }
}

app.whenReady().then(() => {
  const paths = resolveAppPaths(app.getAppPath(), app.getPath("userData"))
  store = new MetricsStore(paths.sqlitePath)
  createWindow()

  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip("OpenCode Token Menubar")
  tray.setTitle("OpenCode")
  tray.on("click", toggleWindow)

  ipcMain.handle("metrics:get-dashboard-data", () => {
    if (!store) throw new Error("Metrics store is not ready")
    const currentPaths = resolveAppPaths(app.getAppPath(), app.getPath("userData"))
    return {
      ...store.getDashboardData({ ...todayRange(), recentLimit: 20 }),
      importErrors,
      pluginInstalled: existsSync(currentPaths.pluginPath),
      paths: {
        jsonl: currentPaths.jsonlPath,
        sqlite: currentPaths.sqlitePath,
        plugin: currentPaths.pluginPath,
      },
    }
  })

  ipcMain.handle("plugin:install", () => {
    const currentPaths = resolveAppPaths(app.getAppPath(), app.getPath("userData"))
    return installPlugin({ sourcePath: currentPaths.bundledPluginPath, targetPath: currentPaths.pluginPath })
  })

  importJsonl()
  chokidar.watch(paths.jsonlPath, { ignoreInitial: true, awaitWriteFinish: true }).on("add", importJsonl).on("change", importJsonl)
})

app.on("window-all-closed", (event) => {
  event.preventDefault()
})

app.on("before-quit", () => {
  store?.close()
})
```

- [ ] **Step 4: Run type/build check**

Run: `bun run build`

Expected: PASS.

- [ ] **Step 5: Commit main process wiring**

Run only if inside a git repository:

```bash
git add src/main/main.ts src/main/preload.ts src/shared/metrics.ts
git commit -m "feat: 串联状态栏数据链路"
```

## Task 7: Build Dashboard Renderer

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Replace dashboard UI**

Replace `src/renderer/App.tsx` with:

```tsx
import { useEffect, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { DashboardData } from "../shared/metrics"

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: value >= 10000 ? "compact" : "standard" }).format(Math.round(value))
}

function formatSpeed(value: number) {
  return `${Math.round(value)} tok/s`
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [installing, setInstalling] = useState(false)

  async function refresh() {
    setData(await window.tokenMetrics.getDashboardData())
  }

  async function installPlugin() {
    setInstalling(true)
    try {
      await window.tokenMetrics.installPlugin()
      await refresh()
    } finally {
      setInstalling(false)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [])

  if (!data) {
    return <main className="app-shell">Loading...</main>
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">OpenCode</p>
          <h1>Token Metrics</h1>
        </div>
        <button className="install-button" disabled={installing} onClick={installPlugin}>
          {data.pluginInstalled ? "Reinstall Plugin" : "Install Plugin"}
        </button>
      </header>

      {!data.pluginInstalled && (
        <section className="notice-card">
          Install the global plugin, then restart OpenCode to start collecting metrics.
        </section>
      )}

      <section className="summary-grid">
        <article><span>Total</span><strong>{formatNumber(data.today.totalTokens)}</strong></article>
        <article><span>Input</span><strong>{formatNumber(data.today.inputTokens)}</strong></article>
        <article><span>Output</span><strong>{formatNumber(data.today.outputTokens)}</strong></article>
        <article><span>Avg Speed</span><strong>{formatSpeed(data.today.averageTokensPerSecond)}</strong></article>
      </section>

      <section className="panel">
        <h2>Hourly Trends</h2>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.hourlyTrends}>
              <defs>
                <linearGradient id="tokens" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.16)" vertical={false} />
              <XAxis dataKey="hour" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
              <Area dataKey="totalTokens" stroke="#60a5fa" fill="url(#tokens)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>Model Ranking</h2>
        <div className="list">
          {data.modelRanking.map((row) => (
            <div className="list-row" key={`${row.provider}/${row.model}`}>
              <span>{row.provider}/{row.model}</span>
              <strong>{formatNumber(row.totalTokens)}</strong>
            </div>
          ))}
          {data.modelRanking.length === 0 && <p className="muted">No model data today.</p>}
        </div>
      </section>

      <section className="panel">
        <h2>Recent Requests</h2>
        <div className="list">
          {data.recent.map((row) => (
            <div className="list-row" key={row.id}>
              <span>{row.provider}/{row.model}</span>
              <strong>{formatNumber(row.totalTokens)} · {formatSpeed(row.tokensPerSecond)}</strong>
            </div>
          ))}
          {data.recent.length === 0 && <p className="muted">No requests imported yet.</p>}
        </div>
      </section>

      <section className="panel settings">
        <h2>Settings</h2>
        <code>{data.paths.plugin}</code>
        <code>{data.paths.jsonl}</code>
        <code>{data.paths.sqlite}</code>
        <p className="muted">Import errors: {data.importErrors}. Restart OpenCode after plugin installation.</p>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Replace dashboard styles**

Replace `src/renderer/styles.css` with:

```css
:root {
  color: #f8fafc;
  background: #020617;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; }

.app-shell {
  min-height: 100vh;
  padding: 20px;
  background:
    radial-gradient(circle at 15% 0%, rgba(59, 130, 246, 0.35), transparent 32%),
    radial-gradient(circle at 100% 18%, rgba(14, 165, 233, 0.18), transparent 28%),
    #020617;
}

.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.eyebrow {
  margin: 0 0 4px;
  color: #93c5fd;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1, h2 { margin: 0; }
h1 { font-size: 28px; }
h2 { margin-bottom: 12px; font-size: 15px; }

.install-button {
  border: 0;
  border-radius: 999px;
  padding: 9px 13px;
  color: #082f49;
  background: #7dd3fc;
  font-weight: 700;
}

.notice-card, .panel, .summary-grid article {
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.74);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(18px);
}

.notice-card {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 16px;
  color: #bfdbfe;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.summary-grid article {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 18px;
}

.summary-grid span, .muted { color: #94a3b8; }
.summary-grid strong { font-size: 24px; }

.panel {
  margin-bottom: 14px;
  padding: 15px;
  border-radius: 20px;
}

.chart-wrap { height: 180px; }

.list { display: grid; gap: 8px; }
.list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}
.list-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row strong { flex: 0 0 auto; color: #bfdbfe; }

.settings { display: grid; gap: 8px; }
code {
  display: block;
  overflow-wrap: anywhere;
  color: #c4b5fd;
  font-size: 11px;
}
```

- [ ] **Step 3: Run build check**

Run: `bun run build`

Expected: PASS.

- [ ] **Step 4: Commit renderer dashboard**

Run only if inside a git repository:

```bash
git add src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat: 实现 token 统计面板"
```

## Task 8: Final Verification and Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README with usage details**

Replace `README.md` with:

```md
# OpenCode Token Menubar

macOS menubar app for viewing OpenCode token usage and token speed.

## Features

- Installs a global OpenCode token metrics plugin.
- Reads raw events from `~/.config/opencode/token-metrics/events.jsonl`.
- Imports events into local SQLite under the app data directory.
- Shows today's tokens, recent requests, model ranking, and hourly trends.

## Development

```bash
bun install
bun run build
bun run dev
```

In another terminal:

```bash
bun run dev:app
```

## Plugin Installation

Use the app's `Install Plugin` button. It writes the bundled plugin to:

```text
~/.config/opencode/plugin/token-metrics.ts
```

Restart OpenCode after installing or reinstalling the plugin. Running OpenCode sessions keep using the plugins that were loaded at startup.

## Data Paths

Raw JSONL events:

```text
~/.config/opencode/token-metrics/events.jsonl
```

SQLite database:

```text
~/Library/Application Support/opencode-token-menubar/metrics.db
```

## Verification

```bash
bun run test
bun run build
```

- [ ] **Step 2: Run focused tests**

Run: `bun run test`

Expected: all Vitest tests pass.

- [ ] **Step 3: Run build**

Run: `bun run build`

Expected: renderer and main builds pass.

- [ ] **Step 4: Run plugin syntax check**

Run: `bun build plugin/token-metrics.ts --external @opencode-ai/plugin --outdir /tmp/opencode-token-plugin-check`

Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

Run: `bun run dev` in one terminal.

Run: `bun run dev:app` in another terminal.

Expected: Electron app starts, status bar item appears, and clicking it opens the dashboard.

- [ ] **Step 6: Commit docs and final verification changes**

Run only if inside a git repository:

```bash
git add README.md
git commit -m "docs: 补充状态栏应用使用说明"
```

## Self-Review Notes

- Spec coverage: tasks cover project scaffold, plugin installation, JSONL event source, SQLite aggregation, menubar UX, dashboard sections, settings, tests, and documentation.
- Placeholder scan: no implementation step relies on unresolved placeholder wording or vague follow-up wording.
- Type consistency: shared types use camelCase in TypeScript and SQL aliases convert snake_case columns back to camelCase dashboard fields.
