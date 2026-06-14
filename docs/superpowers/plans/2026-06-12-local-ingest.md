# Local Ingest Implementation Plan

> 状态: ✅ 已完成

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send OpenCode plugin metric events to the menubar app through a local ingest service, with JSONL only as a fallback queue.

**Architecture:** Electron main owns a loopback HTTP server and all SQLite writes. The plugin reads `ingest.json`, posts `MetricEvent` JSON to the server, and appends JSONL only when local delivery fails. HTTP responses use a consistent `{ code, message, data }` envelope.

**Tech Stack:** Electron main process, Node `http`, Node `crypto`, Node filesystem APIs, `better-sqlite3`, Vitest, OpenCode plugin TypeScript.

---

## File Structure

- Modify `src/shared/metrics.ts`: add the shared `ApiResponse<T>` envelope type used by local ingest responses.
- Modify `src/main/paths.ts`: add `ingestPath` pointing to `~/.config/opencode/token-metrics/ingest.json`.
- Create `src/main/ingestServer.ts`: own the loopback HTTP server, auth token, response envelope, request validation, and metadata file lifecycle.
- Modify `src/main/jsonlImporter.ts`: add a compacting helper for imported fallback JSONL content.
- Modify `src/main/main.ts`: start/stop ingest server, insert local events into SQLite, compact fallback JSONL after successful import, expose `ingestPath` in diagnostics.
- Modify `src/shared/metrics.ts`: include `ingestPath` in dashboard path diagnostics.
- Modify `plugin/token-metrics.ts`: send events to local ingest first; append JSONL only when local delivery fails.
- Add `src/main/ingestServer.test.ts`: verify success, method rejection, route rejection, auth failure, invalid payload, oversized body, and metadata cleanup.
- Modify `src/main/jsonlImporter.test.ts`: verify fallback JSONL compaction resets imported content.
- Modify `src/main/main.ts` only where necessary; keep existing renderer IPC unchanged.

This workspace is currently not a Git repository, and the user has not requested commits. Do not run `git commit` as part of this plan.

---

### Task 1: Add Shared Response And Paths

**Files:**
- Modify: `src/shared/metrics.ts`
- Modify: `src/main/paths.ts`
- Test: `src/main/jsonlImporter.test.ts`

- [ ] **Step 1: Write the failing path test**

Update the existing `resolveAppPaths` assertion in `src/main/jsonlImporter.test.ts` so it expects `ingestPath`:

```ts
expect(resolveAppPaths("/app/root", "/user/data")).toEqual({
  jsonlPath: join(homedir(), ".config", "opencode", "token-metrics", "events.jsonl"),
  ingestPath: join(homedir(), ".config", "opencode", "token-metrics", "ingest.json"),
  sqlitePath: join("/user/data", "metrics.db"),
  pluginPath: join(homedir(), ".config", "opencode", "plugins", "token-metrics.ts"),
  bundledPluginPath: join("/app/root", "plugin", "token-metrics.ts"),
});
```

- [ ] **Step 2: Run the focused failing test**

Run: `bun run test src/main/jsonlImporter.test.ts`

Expected: FAIL because `resolveAppPaths()` does not include `ingestPath` yet.

- [ ] **Step 3: Add the shared response type**

Add this interface after `MetricEvent` in `src/shared/metrics.ts`:

```ts
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}
```

- [ ] **Step 4: Add `ingestPath` to shared diagnostics**

Update `DashboardData.paths` in `src/shared/metrics.ts`:

```ts
paths?: {
  jsonlPath: string;
  ingestPath: string;
  sqlitePath: string;
  pluginPath: string;
};
```

- [ ] **Step 5: Add `ingestPath` to app paths**

Update `src/main/paths.ts`:

```ts
export interface AppPaths {
  jsonlPath: string;
  ingestPath: string;
  sqlitePath: string;
  pluginPath: string;
  bundledPluginPath: string;
}

export function resolveAppPaths(appPath = process.cwd(), userDataPath = process.cwd()): AppPaths {
  const configPath = join(homedir(), ".config", "opencode");
  const tokenMetricsPath = join(configPath, "token-metrics");

  return {
    jsonlPath: join(tokenMetricsPath, "events.jsonl"),
    ingestPath: join(tokenMetricsPath, "ingest.json"),
    sqlitePath: join(userDataPath, "metrics.db"),
    pluginPath: join(configPath, "plugins", "token-metrics.ts"),
    bundledPluginPath: join(appPath, "plugin", "token-metrics.ts"),
  };
}
```

- [ ] **Step 6: Run the focused test again**

Run: `bun run test src/main/jsonlImporter.test.ts`

Expected: PASS.

---

### Task 2: Build Local Ingest Server

**Files:**
- Create: `src/main/ingestServer.ts`
- Create: `src/main/ingestServer.test.ts`

- [ ] **Step 1: Write ingest server tests**

Create `src/main/ingestServer.test.ts` with these tests:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { startIngestServer } from "./ingestServer.js";
import type { MetricEvent } from "../shared/metrics.js";

const metric: MetricEvent = {
  id: "req-1",
  timestamp: "2026-06-12T00:00:00.000Z",
  provider: "anthropic",
  model: "claude-sonnet-4",
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  durationMs: 1000,
  tokensPerSecond: 15,
};

describe("startIngestServer", () => {
  let tempDir: string | undefined;
  let stopServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stopServer?.();
    stopServer = undefined;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function start(options?: { onMetric?: (event: MetricEvent) => void; maxBodyBytes?: number }) {
    tempDir = mkdtempSync(join(tmpdir(), "ingest-server-"));
    const ingestPath = join(tempDir, "token-metrics", "ingest.json");
    const received: MetricEvent[] = [];
    const server = await startIngestServer({
      ingestPath,
      maxBodyBytes: options?.maxBodyBytes,
      onMetric: (event) => {
        received.push(event);
        options?.onMetric?.(event);
      },
    });
    stopServer = server.stop;

    return { ...server, ingestPath, received };
  }

  test("accepts a valid metric and returns code message data", async () => {
    const server = await start();

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify(metric),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 0,
      message: "ok",
      data: { accepted: true },
    });
    expect(server.received).toEqual([metric]);
  });

  test("writes ingest metadata with url and token", async () => {
    const server = await start();

    const metadata = JSON.parse(readFileSync(server.ingestPath, "utf8"));

    expect(metadata.url).toBe(server.url);
    expect(metadata.token).toBe(server.token);
    expect(typeof metadata.updatedAt).toBe("string");
  });

  test("rejects missing bearer token", async () => {
    const server = await start();

    const response = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metric),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 401,
      message: "invalid token",
      data: null,
    });
    expect(server.received).toEqual([]);
  });

  test("rejects non-POST requests with code message data", async () => {
    const server = await start();

    const response = await fetch(server.url, {
      method: "GET",
      headers: { authorization: `Bearer ${server.token}` },
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      code: 405,
      message: "method not allowed",
      data: null,
    });
    expect(server.received).toEqual([]);
  });

  test("rejects unknown routes with code message data", async () => {
    const server = await start();

    const response = await fetch(server.url.replace("/metrics", "/unknown"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify(metric),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 404,
      message: "not found",
      data: null,
    });
    expect(server.received).toEqual([]);
  });

  test("rejects invalid metric payload", async () => {
    const server = await start();

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({ timestamp: metric.timestamp }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: 422,
      message: "invalid metric payload",
      data: null,
    });
    expect(server.received).toEqual([]);
  });

  test("rejects oversized request bodies", async () => {
    const server = await start({ maxBodyBytes: 8 });

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify(metric),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 413,
      message: "request body too large",
      data: null,
    });
    expect(server.received).toEqual([]);
  });

  test("removes metadata on stop", async () => {
    const server = await start();

    expect(existsSync(server.ingestPath)).toBe(true);

    await server.stop();
    stopServer = undefined;

    expect(existsSync(server.ingestPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused failing test**

Run: `bun run test src/main/ingestServer.test.ts`

Expected: FAIL because `src/main/ingestServer.ts` does not exist yet.

- [ ] **Step 3: Implement the ingest server**

Create `src/main/ingestServer.ts`:

```ts
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";

import { normalizeMetricEvent, type ApiResponse, type MetricEvent, type RawMetricEvent } from "../shared/metrics.js";

interface IngestServerOptions {
  ingestPath: string;
  maxBodyBytes?: number;
  onMetric(event: MetricEvent): void;
}

export interface IngestServerHandle {
  url: string;
  token: string;
  stop(): Promise<void>;
}

const defaultMaxBodyBytes = 64 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

function sendJson<T>(response: ServerResponse, statusCode: number, body: ApiResponse<T>): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk: Buffer) => {
      if (tooLarge) {
        return;
      }

      size += chunk.byteLength;
      if (size > maxBodyBytes) {
        tooLarge = true;
        reject(new RequestBodyTooLargeError());
        request.resume();
        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    request.on("error", (error) => {
      if (!tooLarge) {
        reject(error);
      }
    });
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("ingest server address is unavailable"));
        return;
      }

      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startIngestServer({ ingestPath, maxBodyBytes = defaultMaxBodyBytes, onMetric }: IngestServerOptions): Promise<IngestServerHandle> {
  const token = randomBytes(24).toString("base64url");
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { code: 405, message: "method not allowed", data: null });
      return;
    }

    if (request.url !== "/metrics") {
      sendJson(response, 404, { code: 404, message: "not found", data: null });
      return;
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJson(response, 401, { code: 401, message: "invalid token", data: null });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request, maxBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendJson(response, 413, { code: 413, message: "request body too large", data: null });
      } else {
        sendJson(response, 400, { code: 400, message: "failed to read request body", data: null });
      }
      return;
    }

    let metric: MetricEvent | null;
    try {
      metric = normalizeMetricEvent(JSON.parse(rawBody) as RawMetricEvent);
    } catch {
      metric = null;
    }

    if (!metric) {
      sendJson(response, 422, { code: 422, message: "invalid metric payload", data: null });
      return;
    }

    try {
      onMetric(metric);
    } catch {
      sendJson(response, 500, { code: 500, message: "failed to store metric", data: null });
      return;
    }

    sendJson(response, 200, { code: 0, message: "ok", data: { accepted: true } });
  });

  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/metrics`;
  mkdirSync(dirname(ingestPath), { recursive: true });
  writeFileSync(ingestPath, JSON.stringify({ url, token, updatedAt: new Date().toISOString() }, null, 2));

  return {
    url,
    token,
    stop: async () => {
      await close(server);
      rmSync(ingestPath, { force: true });
    },
  };
}
```

- [ ] **Step 4: Run the focused test again**

Run: `bun run test src/main/ingestServer.test.ts`

Expected: PASS.

---

### Task 3: Compact JSONL Fallback After Import

**Files:**
- Modify: `src/main/jsonlImporter.ts`
- Modify: `src/main/jsonlImporter.test.ts`

- [ ] **Step 1: Write JSONL compaction tests**

Append these tests to the `readJsonlEvents` describe block in `src/main/jsonlImporter.test.ts`:

```ts
test("compacts imported complete lines and preserves trailing partial line", () => {
  const firstLine = `${metricLine("req-1")}\n`;
  const partialLine = metricLine("req-2");
  const filePath = tempFile(firstLine + partialLine);
  const firstRead = readJsonlEvents(filePath);

  compactJsonlFile(filePath, firstRead.nextOffset);

  expect(readJsonlEvents(filePath)).toEqual({
    events: [],
    errors: 0,
    nextOffset: 0,
  });

  appendFileSync(filePath, "\n");

  expect(readJsonlEvents(filePath)).toEqual({
    events: [
      {
        id: "req-2",
        timestamp: "2026-06-11T01:02:03.000Z",
        provider: "anthropic",
        model: "claude-sonnet-4",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        durationMs: 3000,
        tokensPerSecond: 5,
      },
    ],
    errors: 0,
    nextOffset: Buffer.byteLength(`${partialLine}\n`),
  });
});

test("compacts a fully imported JSONL file to empty", () => {
  const content = `${metricLine("req-1")}\n${metricLine("req-2")}\n`;
  const filePath = tempFile(content);
  const firstRead = readJsonlEvents(filePath);

  compactJsonlFile(filePath, firstRead.nextOffset);

  expect(readJsonlEvents(filePath)).toEqual({
    events: [],
    errors: 0,
    nextOffset: 0,
  });
});
```

Also update the import line:

```ts
import { compactJsonlFile, readJsonlEvents } from "./jsonlImporter.js";
```

- [ ] **Step 2: Run the focused failing test**

Run: `bun run test src/main/jsonlImporter.test.ts`

Expected: FAIL because `compactJsonlFile` is not exported yet.

- [ ] **Step 3: Implement JSONL compaction**

Update `src/main/jsonlImporter.ts` imports and add the helper after `readJsonlEvents()`:

```ts
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, truncateSync, writeFileSync } from "node:fs";

export function compactJsonlFile(filePath: string, importedOffset: number): void {
  if (!existsSync(filePath) || importedOffset <= 0) {
    return;
  }

  const content = readFileSync(filePath);
  if (importedOffset >= content.byteLength) {
    truncateSync(filePath, 0);
    return;
  }

  writeFileSync(filePath, content.subarray(importedOffset));
}
```

- [ ] **Step 4: Run the focused test again**

Run: `bun run test src/main/jsonlImporter.test.ts`

Expected: PASS.

---

### Task 4: Wire Ingest Server Into Main Process

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Import new server and compaction helper**

Update imports in `src/main/main.ts`:

```ts
import { compactJsonlFile, readJsonlEvents } from "./jsonlImporter.js"
import { startIngestServer, type IngestServerHandle } from "./ingestServer.js"
import type { DashboardData, MetricEvent } from "../shared/metrics.js"
```

Replace the existing shared metrics type import:

```ts
import type { DashboardData } from "../shared/metrics.js"
```

- [ ] **Step 2: Add ingest server state**

Add this near the other module state variables in `src/main/main.ts`:

```ts
let ingestServer: IngestServerHandle | null = null
```

- [ ] **Step 3: Include `ingestPath` in dashboard diagnostics**

Update `getDashboardPaths()` in `src/main/main.ts`:

```ts
return {
  jsonlPath: paths.jsonlPath,
  ingestPath: paths.ingestPath,
  sqlitePath: paths.sqlitePath,
  pluginPath: paths.pluginPath,
}
```

- [ ] **Step 4: Compact fallback JSONL after successful import**

Replace `importNewEvents()` in `src/main/main.ts` with:

```ts
function importNewEvents() {
  if (!store || !paths) return

  const previousOffset = jsonlOffset
  const result = readJsonlEvents(paths.jsonlPath, jsonlOffset)
  jsonlOffset = result.nextOffset
  importErrors += result.errors
  if (result.events.length > 0) {
    store.insertEvents(result.events)
  }
  if (result.nextOffset > previousOffset) {
    compactJsonlFile(paths.jsonlPath, result.nextOffset)
    jsonlOffset = 0
  }
  writeImportState()
  updateTrayTitle()
}
```

- [ ] **Step 5: Add a focused local insert function**

Add this helper after `importNewEvents()` in `src/main/main.ts`:

```ts
function insertLocalMetric(event: MetricEvent) {
  if (!store) {
    throw new Error("Metrics store is not initialized")
  }

  store.insertEvents([event])
  updateTrayTitle()
}
```

- [ ] **Step 6: Start the server during app startup**

In `app.whenReady().then(...)`, after `store = new MetricsStore(paths.sqlitePath)`, add:

```ts
ingestServer = await startIngestServer({
  ingestPath: paths.ingestPath,
  onMetric: insertLocalMetric,
})
```

Then change the callback to async:

```ts
app.whenReady().then(async () => {
```

- [ ] **Step 7: Stop the server on app quit**

Update `app.on("before-quit", ...)`:

```ts
app.on("before-quit", () => {
  void watcher?.close()
  watcher = null
  void ingestServer?.stop()
  ingestServer = null
  store?.close()
  store = null
})
```

- [ ] **Step 8: Run focused main-process tests**

Run: `bun run test src/main/ingestServer.test.ts src/main/jsonlImporter.test.ts src/main/metricsStore.test.ts`

Expected: PASS.

---

### Task 5: Update Plugin Delivery With JSONL Fallback

**Files:**
- Modify: `plugin/token-metrics.ts`

- [ ] **Step 1: Add ingest metadata constants and types**

Add after `MetricEvent` in `plugin/token-metrics.ts`:

```ts
interface IngestMetadata {
  url: string;
  token: string;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}
```

Add after `outputPath`:

```ts
const ingestPath = join(homedir(), ".config", "opencode", "token-metrics", "ingest.json");
```

- [ ] **Step 2: Add metadata and post helpers**

Add these helpers before `appendJsonl()` in `plugin/token-metrics.ts`:

```ts
async function readIngestMetadata($: Shell): Promise<IngestMetadata | undefined> {
  const script = [
    "const fs = require('node:fs');",
    "const target = process.argv[1];",
    "try { process.stdout.write(fs.readFileSync(target, 'utf8')); } catch {}",
  ].join("\n");

  const result = await $`node -e ${script} ${ingestPath}`;
  const text = result.stdout?.toString().trim();
  if (!text) {
    return undefined;
  }

  try {
    const metadata = JSON.parse(text) as Partial<IngestMetadata>;
    if (typeof metadata.url === "string" && typeof metadata.token === "string") {
      return { url: metadata.url, token: metadata.token };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function postMetric(metadata: IngestMetadata, metric: MetricEvent): Promise<boolean> {
  try {
    const response = await fetch(metadata.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${metadata.token}`,
      },
      body: JSON.stringify(metric),
    });
    const body = await response.json() as ApiResponse<{ accepted: boolean } | null>;

    return response.ok && body.code === 0 && body.data?.accepted === true;
  } catch {
    return false;
  }
}

async function deliverMetric($: Shell, metric: MetricEvent): Promise<void> {
  const metadata = await readIngestMetadata($);
  if (metadata && await postMetric(metadata, metric)) {
    return;
  }

  await appendJsonl($, metric);
}
```

- [ ] **Step 3: Switch event handling to `deliverMetric()`**

Replace the existing `await appendJsonl($, { ... })` call with:

```ts
await deliverMetric($, {
  id: `${id}-${now}`,
  timestamp: new Date().toISOString(),
  provider: metadata.provider,
  model: metadata.model,
  inputTokens: deltaInputTokens,
  outputTokens: deltaOutputTokens,
  totalTokens,
  durationMs,
  tokensPerSecond: durationMs > 0 ? totalTokens / (durationMs / 1000) : 0,
});
```

- [ ] **Step 4: Run TypeScript build**

Run: `bun run build:main`

Expected: PASS. This build only compiles `src`, so plugin TypeScript syntax is not fully checked by this command.

---

### Task 6: Verify End-To-End Behavior

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run: `bun run test src/main/ingestServer.test.ts src/main/jsonlImporter.test.ts src/main/metricsStore.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full project tests**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 3: Run build verification**

Run: `bun run build`

Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run in one terminal: `bun run dev`

Run in another terminal: `bun run dev:app`

Expected after the Electron app starts:

- `~/.config/opencode/token-metrics/ingest.json` exists.
- The JSON file contains `url`, `token`, and `updatedAt`.
- Installing the plugin still writes to `~/.config/opencode/plugins/token-metrics.ts`.
- After restarting OpenCode and triggering one model call, SQLite dashboard data updates.
- `~/.config/opencode/token-metrics/events.jsonl` stays empty or small while the app is running.

---

## Self-Review Notes

- Spec coverage: local HTTP ingest, metadata file, `code/message/data` responses, JSONL fallback, compaction, app-owned SQLite writes, and shutdown cleanup are covered by Tasks 1-6.
- Scope: direct SQLite writes from the plugin, remote telemetry, and renderer IPC changes remain out of scope.
- Type consistency: `ApiResponse<T>`, `MetricEvent`, `RawMetricEvent`, `ingestPath`, and `IngestServerHandle` names are consistent across tasks.
- Testing: focused tests precede implementation tasks, and final verification includes focused tests, full tests, build, and manual smoke checks.
