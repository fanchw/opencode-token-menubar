# IM Bridge Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 menubar app 增加 Telegram 远程桥接，实现通过 Telegram bot 实时查看 OpenCode 状态并远程控制会话（发 prompt、中止、批准权限）。

**Architecture:** 单进程 + 三层模块化（IM Adapter → Bridge Core → OpenCode Proxy）。app 内置 OpenCode 官方 Client SDK（`@opencode-ai/sdk`）作为 OpenCode 的远程代理，通过 SSE 订阅事件流，通过 HTTP API 控制会话。Telegram adapter 用长轮询 + `editMessageText` 防抖节流。

**Tech Stack:** TypeScript (ES modules, `.js` 导入)、Electron 主进程、`@opencode-ai/sdk`、Telegram Bot API（原生 fetch，无额外库）、vitest。

**Spec:** `docs/superpowers/specs/2026-06-17-im-bridge-remote-control-design.md`

---

## File Structure

```
src/main/bridge/
  config.ts + config.test.ts        # 读 bridge.json + 校验
  router.ts + router.test.ts        # 指令解析纯函数
  adapter/
    types.ts                        # IMAdapter 接口 + IncomingMessage + OutgoingEvent
    telegram.ts + telegram.test.ts  # 长轮询 + 节流 + 发送 + inline keyboard
  proxy/
    opencode.ts + opencode.test.ts  # SDK 封装 + SSE 订阅 + 事件映射 + 重连
  bridge.ts + bridge.test.ts        # 中枢：路由 + 会话映射 + 排队
# 修改
src/main/paths.ts                   # 加 bridgeConfigPath
src/main/main.ts                    # 启动/停止 bridge
src/main/preload.ts                 # IPC: bridge:start/stop/status
```

**导入约定**：项目用 ES modules + tsc，所有相对导入用 `.js` 扩展名（即使源文件是 `.ts`）。

---

## Task 1: 配置层 config.ts

**Files:**
- Create: `src/main/bridge/config.ts`
- Test: `src/main/bridge/config.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/main/bridge/config.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readBridgeConfig } from "./config.js"

describe("readBridgeConfig", () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `bridge-cfg-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("返回 undefined 当文件不存在", () => {
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined()
  })

  it("解析完整配置并填充默认值", () => {
    writeFileSync(
      join(dir, "bridge.json"),
      JSON.stringify({ telegram: { botToken: "abc:123" } }),
    )
    const cfg = readBridgeConfig(join(dir, "bridge.json"))
    expect(cfg).toBeDefined()
    expect(cfg!.telegram.botToken).toBe("abc:123")
    expect(cfg!.opencode.baseUrl).toBe("http://localhost:4096")
    expect(cfg!.throttleMs).toBe(1500)
    expect(cfg!.autoApprove).toBe(false)
    expect(cfg!.allowlist).toBeUndefined()
  })

  it("缺 botToken 时返回 undefined", () => {
    writeFileSync(join(dir, "bridge.json"), JSON.stringify({ telegram: {} }))
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined()
  })

  it("尊重自定义 baseUrl / throttleMs / autoApprove / allowlist", () => {
    writeFileSync(
      join(dir, "bridge.json"),
      JSON.stringify({
        telegram: { botToken: "t" },
        opencode: { baseUrl: "http://host:1234" },
        throttleMs: 3000,
        autoApprove: true,
        allowlist: [111, 222],
      }),
    )
    const cfg = readBridgeConfig(join(dir, "bridge.json"))!
    expect(cfg.opencode.baseUrl).toBe("http://host:1234")
    expect(cfg.throttleMs).toBe(3000)
    expect(cfg.autoApprove).toBe(true)
    expect(cfg.allowlist).toEqual([111, 222])
  })

  it("损坏的 JSON 返回 undefined", () => {
    writeFileSync(join(dir, "bridge.json"), "{not json")
    expect(readBridgeConfig(join(dir, "bridge.json"))).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/config.test.ts`
Expected: FAIL — 模块 `./config.js` 不存在

- [ ] **Step 3: 写实现**

创建 `src/main/bridge/config.ts`：

```typescript
import { readFileSync } from "node:fs"

export interface BridgeConfig {
  telegram: { botToken: string }
  opencode: { baseUrl: string }
  allowlist?: number[]
  autoApprove: boolean
  throttleMs: number
}

export function readBridgeConfig(configPath: string): BridgeConfig | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"))
  } catch {
    return undefined
  }

  if (!raw || typeof raw !== "object") return undefined
  const obj = raw as Record<string, unknown>
  const botToken = obj.telegram && (obj.telegram as Record<string, unknown>).botToken
  if (typeof botToken !== "string" || !botToken) return undefined

  const opencode = (obj.opencode as Record<string, unknown> | undefined) ?? {}
  const baseUrl = typeof opencode.baseUrl === "string" ? opencode.baseUrl : "http://localhost:4096"

  const allowlist = Array.isArray(obj.allowlist)
    ? obj.allowlist.filter((v): v is number => typeof v === "number")
    : undefined

  return {
    telegram: { botToken },
    opencode: { baseUrl },
    allowlist: allowlist && allowlist.length > 0 ? allowlist : undefined,
    autoApprove: obj.autoApprove === true,
    throttleMs: typeof obj.throttleMs === "number" && Number.isFinite(obj.throttleMs) ? obj.throttleMs : 1500,
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/config.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/config.ts src/main/bridge/config.test.ts
git commit -m "feat: 实现桥接配置读取层"
```

---

## Task 2: 指令解析 router.ts

**Files:**
- Create: `src/main/bridge/router.ts`
- Test: `src/main/bridge/router.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/main/bridge/router.test.ts`：

```typescript
import { describe, it, expect } from "vitest"
import { parseCommand } from "./router.js"

describe("parseCommand", () => {
  it("普通文本解析为 prompt", () => {
    expect(parseCommand("hello world")).toEqual({ kind: "prompt", text: "hello world" })
  })

  it("空文本解析为空 prompt", () => {
    expect(parseCommand("   ")).toEqual({ kind: "prompt", text: "" })
  })

  it("/new 解析为 new 命令", () => {
    expect(parseCommand("/new")).toEqual({ kind: "new" })
  })

  it("/abort 解析为 abort", () => {
    expect(parseCommand("/abort")).toEqual({ kind: "abort" })
  })

  it("/list 解析为 list", () => {
    expect(parseCommand("/list")).toEqual({ kind: "list" })
  })

  it("/status 解析为 status", () => {
    expect(parseCommand("/status")).toEqual({ kind: "status" })
  })

  it("/help 解析为 help", () => {
    expect(parseCommand("/help")).toEqual({ kind: "help" })
  })

  it("/switch 带参数解析 sessionId", () => {
    expect(parseCommand("/switch abc123")).toEqual({ kind: "switch", sessionId: "abc123" })
  })

  it("/switch 不带参数 sessionId 为空字符串", () => {
    expect(parseCommand("/switch")).toEqual({ kind: "switch", sessionId: "" })
  })

  it("命令大小写不敏感", () => {
    expect(parseCommand("/NEW")).toEqual({ kind: "new" })
  })

  it("未知 / 命令回退为 prompt", () => {
    expect(parseCommand("/unknown blah")).toEqual({ kind: "prompt", text: "/unknown blah" })
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/router.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

创建 `src/main/bridge/router.ts`：

```typescript
export type Command =
  | { kind: "new" }
  | { kind: "abort" }
  | { kind: "list" }
  | { kind: "switch"; sessionId: string }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "prompt"; text: string }

export function parseCommand(text: string): Command {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) {
    return { kind: "prompt", text: trimmed }
  }

  const parts = trimmed.slice(1).split(/\s+/)
  const cmd = (parts[0] ?? "").toLowerCase()
  const arg = parts[1] ?? ""

  switch (cmd) {
    case "new":
      return { kind: "new" }
    case "abort":
      return { kind: "abort" }
    case "list":
      return { kind: "list" }
    case "switch":
      return { kind: "switch", sessionId: arg }
    case "status":
      return { kind: "status" }
    case "help":
      return { kind: "help" }
    default:
      return { kind: "prompt", text: trimmed }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/router.test.ts`
Expected: PASS（11 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/router.ts src/main/bridge/router.test.ts
git commit -m "feat: 实现指令解析纯函数"
```

---

## Task 3: Adapter 共享类型 adapter/types.ts

**Files:**
- Create: `src/main/bridge/adapter/types.ts`

此任务无逻辑，仅类型定义，不单独写测试（类型由后续 adapter/proxy/bridge 的测试覆盖）。

- [ ] **Step 1: 写类型定义**

创建 `src/main/bridge/adapter/types.ts`：

```typescript
// IM 平台 → Bridge：收到的消息
export interface IncomingMessage {
  chatId: string
  userId: number
  text: string
  // inline keyboard 按钮回调（如权限批准/拒绝）
  callbackData?: string
}

// Bridge → IM 平台：要推送的事件
export interface OutgoingEvent {
  chatId: string
  kind: "thinking" | "delta" | "tool" | "tool_result" | "done" | "error" | "permission"
  text: string
  sessionId?: string
  toolName?: string
  toolStatus?: "start" | "success" | "error"
  // permission 事件携带的权限请求 id，用于回调响应
  permissionId?: string
  // permission 事件携带的会话 id + 权限 id 组合，用于 inline keyboard 回调
  permissionSessionId?: string
}

// 所有 IM 平台 adapter 实现的统一接口
export interface IMAdapter {
  start(onMessage: (msg: IncomingMessage) => void): Promise<void>
  stop(): Promise<void>
  send(event: OutgoingEvent): Promise<void>
}
```

- [ ] **Step 2: 验证类型可编译**

Run: `bun run build:main`
Expected: 编译通过，无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/main/bridge/adapter/types.ts
git commit -m "feat: 定义 IM adapter 共享类型"
```

---

## Task 4: OpenCode Proxy — 控制方法封装

**Files:**
- Create: `src/main/bridge/proxy/opencode.ts`
- Test: `src/main/bridge/proxy/opencode.test.ts`

- [ ] **Step 1: 安装 SDK 依赖**

Run: `bun add @opencode-ai/sdk`

- [ ] **Step 2: 写失败测试**

创建 `src/main/bridge/proxy/opencode.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest"
import { OpenCodeProxy } from "./opencode.js"

// 构造 mock client
function makeMockClient(overrides: Record<string, unknown> = {}) {
  const session = {
    create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
    list: vi.fn().mockResolvedValue({ data: [{ id: "sess-1", title: "t" }] }),
    get: vi.fn().mockResolvedValue({ data: { id: "sess-1", model: { id: "claude" } } }),
    abort: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
    promptAsync: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
    ...overrides,
  }
  const postSessionIdPermissionsPermissionId = vi.fn().mockResolvedValue({ data: {} })
  return { session, postSessionIdPermissionsPermissionId }
}

describe("OpenCodeProxy 控制方法", () => {
  it("createSession 返回 session id", async () => {
    const mock = makeMockClient()
    const proxy = new OpenCodeProxy(mock as never)
    expect(await proxy.createSession()).toBe("sess-1")
    expect(mock.session.create).toHaveBeenCalled()
  })

  it("listSessions 返回会话数组", async () => {
    const mock = makeMockClient()
    const proxy = new OpenCodeProxy(mock as never)
    const list = await proxy.listSessions()
    expect(list).toEqual([{ id: "sess-1", title: "t" }])
  })

  it("getSession 调用 get 并返回 data", async () => {
    const mock = makeMockClient()
    const proxy = new OpenCodeProxy(mock as never)
    const s = await proxy.getSession("sess-1")
    expect(s).toEqual({ id: "sess-1", model: { id: "claude" } })
    expect(mock.session.get).toHaveBeenCalledWith({ path: { id: "sess-1" } })
  })

  it("abort 调用 session.abort", async () => {
    const mock = makeMockClient()
    const proxy = new OpenCodeProxy(mock as never)
    await proxy.abort("sess-1")
    expect(mock.session.abort).toHaveBeenCalledWith({ path: { id: "sess-1" } })
  })

  it("promptAsync 用正确的 parts 结构调用", async () => {
    const mock = makeMockClient()
    const proxy = new OpenCodeProxy(mock as never)
    await proxy.promptAsync("sess-1", "写测试")
    expect(mock.session.promptAsync).toHaveBeenCalledWith({
      path: { id: "sess-1" },
      body: { parts: [{ type: "text", text: "写测试" }] },
    })
  })

  it("respondPermission 调用权限响应端点", async () => {
    const mock = makeMockClient()
    const proxy = new OpenCodeProxy(mock as never)
    await proxy.respondPermission("sess-1", "perm-9", "once")
    expect(mock.postSessionIdPermissionsPermissionId).toHaveBeenCalledWith({
      path: { id: "sess-1", permissionID: "perm-9" },
      body: { response: "once" },
    })
  })
})
```

- [ ] **Step 3: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/proxy/opencode.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 4: 写实现**

创建 `src/main/bridge/proxy/opencode.ts`：

```typescript
import type { OpencodeClient } from "@opencode-ai/sdk"

export interface SessionSummary {
  id: string
  title?: string
}

export class OpenCodeProxy {
  constructor(private client: OpencodeClient) {}

  static fromBaseUrl(baseUrl: string): OpenCodeProxy {
    // 动态导入避免 main 进程启动时强依赖
    const { createOpencodeClient } = require("@opencode-ai/sdk") as typeof import("@opencode-ai/sdk")
    return new OpenCodeProxy(createOpencodeClient({ baseUrl }))
  }

  async createSession(): Promise<string> {
    const res = await this.client.session.create()
    return res.data.id
  }

  async listSessions(): Promise<SessionSummary[]> {
    const res = await this.client.session.list()
    return (res.data ?? []) as SessionSummary[]
  }

  async getSession(id: string) {
    const res = await this.client.session.get({ path: { id } })
    return res.data
  }

  async abort(id: string): Promise<void> {
    await this.client.session.abort({ path: { id } })
  }

  async promptAsync(id: string, text: string): Promise<void> {
    await this.client.session.promptAsync({
      path: { id },
      body: { parts: [{ type: "text" as const, text }] },
    })
  }

  // 权限响应：三态（once=本次允许 / always=永久允许 / reject=拒绝）
  // 注意：旧端点 POST /session/{id}/permissions/{permissionID} 已 deprecated，
  // 但 SDK 仍暴露此方法，且 body 是 { response: "once"|"always"|"reject" }（源码核实）
  async respondPermission(sessionId: string, permissionId: string, response: "once" | "always" | "reject"): Promise<void> {
    await this.client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response },
    })
  }
}
```

- [ ] **Step 5: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/proxy/opencode.test.ts`
Expected: PASS（6 个用例全绿）

- [ ] **Step 6: 提交**

```bash
git add src/main/bridge/proxy/opencode.ts src/main/bridge/proxy/opencode.test.ts package.json bun.lock
git commit -m "feat: 封装 OpenCode Proxy 控制方法"
```

---

## Task 5: OpenCode Proxy — SSE 事件订阅与映射

**Files:**
- Modify: `src/main/bridge/proxy/opencode.ts`
- Modify: `src/main/bridge/proxy/opencode.test.ts`

此任务给 Proxy 增加事件订阅能力：连接 `client.global.event()` SSE 流，把 OpenCode 原始事件映射成 `OutgoingEvent`，按 `sessionId → chatId` 反向映射回调给 Bridge。

- [ ] **Step 0: 探测真实事件结构（一次性）**

在写映射逻辑前，连真实 OpenCode 确认 SSE 事件的 `type` 字段值。创建临时脚本 `/tmp/probe-sse.ts`：

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })
// 源码核实：返回 { stream: AsyncGenerator }，global 流 yield { directory, payload: { id, type, properties } }
const sse = await client.global.event()
for await (const entry of sse.stream as any) {
  const payload = entry.payload ?? entry
  console.log(JSON.stringify({ type: payload.type, properties: payload.properties }))
}
```

Run: `bun /tmp/probe-sse.ts`（在另一个终端触发一次 OpenCode 会话）

预期 type（已从源码 `packages/core/src/v1/session.ts` + `packages/opencode/src/permission/index.ts` + `session/status.ts` 核实）：
- `session.status`（busy/idle）— 会话状态
- `message.part.delta` — 流式增量
- `message.part.updated` — 消息部分更新（part.type 为 text/tool）
- `permission.asked` — 权限请求

注意：`tool.execute.before/after` 是**插件钩子**，**不是** SSE 事件。工具状态通过 `message.part.updated`（part.type="tool"）传递。此脚本用于验证实际运行版本的 type 与当前源码一致。

- [ ] **Step 1: 扩充测试 — 事件映射纯函数**

在 `opencode.test.ts` 顶部 import 区追加：

```typescript
import { mapOpenCodeEvent } from "./opencode.js"
```

在 describe 块后追加：

```typescript
describe("mapOpenCodeEvent 事件映射", () => {
  const sessionId = "sess-1"

  it("session.status busy 映射为 thinking", () => {
    const out = mapOpenCodeEvent(
      { type: "session.status", properties: { sessionID: sessionId, status: "busy" } },
      "chat-1",
    )
    expect(out).toEqual({ chatId: "chat-1", kind: "thinking", text: "", sessionId })
  })

  it("session.status idle 映射为 done", () => {
    const out = mapOpenCodeEvent(
      { type: "session.status", properties: { sessionID: sessionId, status: "idle" } },
      "chat-1",
    )
    expect(out).toEqual({ chatId: "chat-1", kind: "done", text: "", sessionId })
  })

  it("message.part.delta 映射为 delta", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.delta", properties: { sessionID: sessionId, delta: "你好" } },
      "chat-1",
    )
    expect(out).toEqual({ chatId: "chat-1", kind: "delta", text: "你好", sessionId })
  })

  it("message.part.updated 带 text part 映射为 delta", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.updated", properties: { sessionID: sessionId, part: { type: "text", text: "完整文本" } } },
      "chat-1",
    )
    expect(out).toEqual({ chatId: "chat-1", kind: "delta", text: "完整文本", sessionId })
  })

  it("message.part.updated 带 tool part 无 output 时映射为 tool(start)", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.updated", properties: { sessionID: sessionId, part: { type: "tool", tool: "bash", input: { command: "ls" } } } },
      "chat-1",
    )
    expect(out?.kind).toBe("tool")
    expect(out?.toolName).toBe("bash")
    expect(out?.text).toBe("ls")
    expect(out?.toolStatus).toBe("start")
  })

  it("message.part.updated 带 tool part 有 output 时映射为 tool_result", () => {
    const out = mapOpenCodeEvent(
      { type: "message.part.updated", properties: { sessionID: sessionId, part: { type: "tool", tool: "bash", output: "file1\nfile2" } } },
      "chat-1",
    )
    expect(out?.kind).toBe("tool_result")
    expect(out?.toolName).toBe("bash")
    expect(out?.text).toBe("file1\nfile2")
    expect(out?.toolStatus).toBe("success")
  })

  it("permission.asked 映射为 permission 事件", () => {
    const out = mapOpenCodeEvent(
      { type: "permission.asked", properties: { sessionID: sessionId, id: "perm-1", permission: "bash", metadata: { command: "ls" } } },
      "chat-1",
    )
    expect(out?.kind).toBe("permission")
    expect(out?.permissionId).toBe("perm-1")
    expect(out?.permissionSessionId).toBe(sessionId)
    expect(out?.text).toContain("bash")
  })

  it("未知 type 返回 null（丢弃）", () => {
    const out = mapOpenCodeEvent({ type: "unknown.thing", properties: {} }, "chat-1")
    expect(out).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/proxy/opencode.test.ts`
Expected: FAIL — `mapOpenCodeEvent` 未导出

- [ ] **Step 3: 写 mapOpenCodeEvent 实现**

在 `opencode.ts` 顶部 import 区追加：

```typescript
import type { OutgoingEvent } from "../adapter/types.js"
```

在 class 之前追加映射纯函数：

```typescript
// OpenCode SSE 事件的宽松类型（实际结构以 Step 0 探测为准）
interface RawOpenCodeEvent {
  type: string
  properties?: Record<string, unknown>
}

// 把单个 OpenCode 事件映射成 OutgoingEvent；无法识别的返回 null
// 事件 type 值基于 OpenCode 源码核实（packages/core/src/v1/session.ts, packages/opencode/src/permission/index.ts 等）
export function mapOpenCodeEvent(raw: RawOpenCodeEvent, chatId: string): OutgoingEvent | null {
  const props = (raw.properties ?? {}) as Record<string, unknown>
  const sessionId = typeof props.sessionID === "string" ? props.sessionID : undefined

  switch (raw.type) {
    // 会话状态：busy=开始思考，idle=完成
    case "session.status": {
      const status = props.status
      if (status === "busy") {
        return { chatId, kind: "thinking", text: "", sessionId }
      }
      if (status === "idle") {
        return { chatId, kind: "done", text: "", sessionId }
      }
      return null
    }

    // 流式增量：delta 是字段增量字符串
    case "message.part.delta": {
      const delta = typeof props.delta === "string" ? props.delta : ""
      return { chatId, kind: "delta", text: delta, sessionId }
    }

    // 消息部分更新：根据 part.type 分流（text / tool）
    case "message.part.updated":
    case "message.updated": {
      const part = props.part as Record<string, unknown> | undefined
      if (!part) return null

      if (part.type === "text") {
        const text = typeof part.text === "string" ? part.text : ""
        return { chatId, kind: "delta", text, sessionId }
      }

      if (part.type === "tool") {
        const toolName = typeof part.tool === "string"
          ? part.tool
          : (typeof part.id === "string" ? part.id : "tool")
        const input = part.input as Record<string, unknown> | undefined
        const detail = input && typeof input.command === "string" ? input.command : ""
        const output = typeof part.output === "string" ? part.output : ""
        const isError = part.error != null
        // 有 output 或 error → tool_result；否则 → tool(start)
        if (output || isError) {
          return { chatId, kind: "tool_result", text: output, sessionId, toolName, toolStatus: isError ? "error" : "success" }
        }
        return { chatId, kind: "tool", text: detail, sessionId, toolName, toolStatus: "start" }
      }

      return null
    }

    // 权限请求：携带 id(权限请求id) + permission(工具名) + metadata(工具输入)
    case "permission.asked": {
      const permissionId = typeof props.id === "string" ? props.id : ""
      const toolName = typeof props.permission === "string" ? props.permission : "unknown"
      const meta = props.metadata as Record<string, unknown> | undefined
      const detail = meta && typeof meta.command === "string" ? meta.command : ""
      const text = `🔐 ${toolName}${detail ? `: ${detail}` : ""}`
      return { chatId, kind: "permission", text, sessionId, permissionId, permissionSessionId: sessionId }
    }

    default:
      return null
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/proxy/opencode.test.ts`
Expected: PASS（映射用例全绿）

- [ ] **Step 5: 给 Proxy 加 subscribe 方法**

在 `opencode.ts` 的 `OpenCodeProxy` class 内部，`respondPermission` 方法之后追加：

```typescript
  // 订阅全局 SSE 事件流；onEvent 接收映射后的 OutgoingEvent
  // getChatId: 实时查询 sessionId → chatId（用函数而非 Map 快照，确保 /new /switch 新绑定后能立即收到事件）
  // 返回停止函数
  subscribe(
    getChatId: (sessionId: string) => string | undefined,
    onEvent: (event: OutgoingEvent) => void,
  ): () => void {
    let stopped = false
    let reconnectDelay = 1000

    const loop = async () => {
      while (!stopped) {
        try {
          // 源码核实：client.global.event() 返回 { stream: AsyncGenerator }
          // /global/event 流每个 yield 是 { directory, payload: { id, type, properties } }
          const sse = await this.client.global.event()
          const stream = (sse as unknown as { stream: AsyncIterable<{ payload?: { type: string; properties: Record<string, unknown> } }> }).stream
          if (!stream || typeof (stream as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") {
            throw new Error("SSE stream 不可迭代")
          }
          for await (const entry of stream) {
            if (stopped) break
            const payload = entry.payload
            if (!payload) continue
            const sessionId = payload.properties?.sessionID
            if (typeof sessionId !== "string") continue
            const chatId = getChatId(sessionId)
            if (!chatId) continue
            const mapped = mapOpenCodeEvent({ type: payload.type, properties: payload.properties }, chatId)
            if (mapped) onEvent(mapped)
          }
          // 流正常结束，重置退避
          reconnectDelay = 1000
        } catch {
          // 连接失败或断线，指数退避重连
        }
        if (stopped) break
        await new Promise((r) => setTimeout(r, reconnectDelay))
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      }
    }

    void loop()
    return () => {
      stopped = true
    }
  }
```

- [ ] **Step 6: 提交**

```bash
git add src/main/bridge/proxy/opencode.ts src/main/bridge/proxy/opencode.test.ts
git commit -m "feat: 实现 SSE 事件订阅与映射"
```

---

## Task 6: Telegram Adapter — 初始化与命令菜单

**Files:**
- Create: `src/main/bridge/adapter/telegram.ts`
- Test: `src/main/bridge/adapter/telegram.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/main/bridge/adapter/telegram.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TelegramAdapter } from "./telegram.js"

// mock global fetch
function mockFetch(responses: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const matcher = Object.keys(responses).find((k) => url.includes(k))
    const body = matcher ? responses[matcher] : { ok: true }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response
  })
  return { fn, calls }
}

describe("TelegramAdapter 初始化", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch as never
  })

  it("verifyToken 调用 getMe 并返回 bot 信息", async () => {
    const { fn } = mockFetch({ "/getMe": { ok: true, result: { id: 42, username: "mybot" } } })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 })
    const info = await adapter.verifyToken()
    expect(info).toEqual({ id: 42, username: "mybot" })
  })

  it("verifyToken 失败时抛错", async () => {
    const { fn } = mockFetch({ "/getMe": { ok: false, description: "bad token" } })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 })
    await expect(adapter.verifyToken()).rejects.toThrow()
  })

  it("registerCommands 调用 setMyCommands", async () => {
    const { fn, calls } = mockFetch({ "/setMyCommands": { ok: true } })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 })
    await adapter.registerCommands()
    const call = calls.find((c) => c.url.includes("/setMyCommands"))
    expect(call).toBeDefined()
    const body = JSON.parse(call!.init!.body as string)
    expect(body.commands).toContainEqual({ command: "new", description: expect.any(String) })
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现（初始化部分）**

创建 `src/main/bridge/adapter/telegram.ts`：

```typescript
import type { IMAdapter, IncomingMessage, OutgoingEvent } from "./types.js"

export interface TelegramConfig {
  botToken: string
  throttleMs: number
}

const API_BASE = "https://api.telegram.org/bot"

interface TelegramApiResult<T> {
  ok: boolean
  result?: T
  description?: string
}

export interface BotInfo {
  id: number
  username: string
}

// 命令菜单定义
export const BOT_COMMANDS = [
  { command: "new", description: "新建 OpenCode 会话" },
  { command: "list", description: "列出会话" },
  { command: "switch", description: "切换会话 (用法: /switch <id>)" },
  { command: "abort", description: "中止当前任务" },
  { command: "status", description: "查看当前状态" },
  { command: "help", description: "帮助" },
]

export class TelegramAdapter implements IMAdapter {
  private baseUrl: string
  private throttleMs: number

  constructor(config: TelegramConfig) {
    this.baseUrl = `${API_BASE}/${config.botToken}`
    this.throttleMs = config.throttleMs
  }

  private async api<T>(method: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = (await res.json()) as TelegramApiResult<T>
    if (!data.ok) {
      throw new Error(`telegram ${method} failed: ${data.description ?? "unknown"}`)
    }
    return data.result as T
  }

  // 校验 token 有效性
  async verifyToken(): Promise<BotInfo> {
    return this.api<BotInfo>("getMe")
  }

  // 注册命令菜单
  async registerCommands(): Promise<void> {
    await this.api("setMyCommands", { commands: BOT_COMMANDS })
  }

  // 以下方法在 Task 7/8/9 实现
  async start(_onMessage: (msg: IncomingMessage) => void): Promise<void> {
    throw new Error("not implemented")
  }

  async stop(): Promise<void> {
    throw new Error("not implemented")
  }

  async send(_event: OutgoingEvent): Promise<void> {
    throw new Error("not implemented")
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: PASS（3 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/adapter/telegram.ts src/main/bridge/adapter/telegram.test.ts
git commit -m "feat: 实现 Telegram adapter 初始化与命令菜单"
```

---

## Task 7: Telegram Adapter — 长轮询收消息 + callback

**Files:**
- Modify: `src/main/bridge/adapter/telegram.ts`
- Modify: `src/main/bridge/adapter/telegram.test.ts`

- [ ] **Step 1: 追加测试 — 长轮询与 offset 管理**

在 `telegram.test.ts` 末尾追加：

```typescript
describe("TelegramAdapter 长轮询收消息", () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch as never
  })

  it("getUpdates 返回消息并回调 onMessage，offset 递增", async () => {
    const updates = {
      ok: true,
      result: [
        { update_id: 100, message: { chat: { id: 555 }, from: { id: 1 }, text: "hi" } },
        {
          update_id: 101,
          callback_query: { from: { id: 2 }, data: "approve:sess-1:perm-1", message: { chat: { id: 555 } } },
        },
      ],
    }
    const { fn } = mockFetch({ "/getUpdates": updates, "/answerCallbackQuery": { ok: true } })
    globalThis.fetch = fn as never

    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 1500 })
    const received: IncomingMessage[] = []
    // 直接调用内部 pollOnce（通过 start 后立即 stop 来测一轮）
    // 这里用类型转换访问私有方法仅用于测试
    const poll = (adapter as unknown as { pollOnce: (cb: (m: IncomingMessage) => void) => Promise<void> })
    await poll.pollOnce((m) => received.push(m))

    expect(received).toEqual([
      { chatId: "555", userId: 1, text: "hi" },
      { chatId: "555", userId: 2, text: "", callbackData: "approve:sess-1:perm-1" },
    ])
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: FAIL — `pollOnce` 不存在

- [ ] **Step 3: 实现长轮询**

在 `telegram.ts` 的 class 内，把 `start` / `stop` 替换为以下实现，并新增 `pollOnce`：

```typescript
  private offset = 0
  private polling = false
  private onMessage: ((msg: IncomingMessage) => void) | null = null

  // 单轮长轮询（测试可单独调用）
  async pollOnce(cb: (msg: IncomingMessage) => void): Promise<void> {
    const updates = await this.api<
      Array<{
        update_id: number
        message?: { chat: { id: number }; from: { id: number }; text?: string }
        callback_query?: { from: { id: number }; data?: string; message: { chat: { id: number } } }
      }>
    >("getUpdates", { offset: this.offset, timeout: 30 })

    for (const u of updates) {
      this.offset = u.update_id + 1
      if (u.message) {
        cb({
          chatId: String(u.message.chat.id),
          userId: u.message.from.id,
          text: u.message.text ?? "",
        })
      } else if (u.callback_query) {
        // 应答 callback 避免 loading 转圈
        await this.api("answerCallbackQuery", { callback_query_id: u.callback_query.from.id }).catch(() => {})
        cb({
          chatId: String(u.callback_query.message.chat.id),
          userId: u.callback_query.from.id,
          text: "",
          callbackData: u.callback_query.data,
        })
      }
    }
  }

  async start(onMessage: (msg: IncomingMessage) => void): Promise<void> {
    this.onMessage = onMessage
    this.polling = true
    // 轮询循环
    const loop = async () => {
      while (this.polling && this.onMessage) {
        try {
          await this.pollOnce(this.onMessage)
        } catch {
          // 网络错误，短暂等待后重试
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
    }
    void loop()
  }

  async stop(): Promise<void> {
    this.polling = false
    this.onMessage = null
  }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: PASS（4 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/adapter/telegram.ts src/main/bridge/adapter/telegram.test.ts
git commit -m "feat: 实现 Telegram 长轮询收消息与 offset 管理"
```

---

## Task 8: Telegram Adapter — 发送 + 节流 + 分段

**Files:**
- Modify: `src/main/bridge/adapter/telegram.ts`
- Modify: `src/main/bridge/adapter/telegram.test.ts`

- [ ] **Step 1: 追加测试 — send 行为与节流**

在 `telegram.test.ts` 末尾追加：

```typescript
describe("TelegramAdapter send 节流与分段", () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch as never
  })

  it("thinking 事件发占位消息并记录 messageId", async () => {
    const { fn, calls } = mockFetch({ "/sendMessage": { ok: true, result: { message_id: 77 } } })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 })
    await adapter.send({ chatId: "9", kind: "thinking", text: "" })
    const sm = calls.find((c) => c.url.includes("/sendMessage"))
    expect(sm).toBeDefined()
    // 占位消息内部应记录 messageId（通过后续 delta edit 来验证）
    expect(JSON.parse(sm!.init!.body as string).text).toContain("思考中")
  })

  it("delta 事件防抖后 editMessageText 同一条消息", async () => {
    const { fn, calls } = mockFetch({
      "/sendMessage": { ok: true, result: { message_id: 88 } },
      "/editMessageText": { ok: true },
    })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 })
    await adapter.send({ chatId: "9", kind: "thinking", text: "" })
    await adapter.send({ chatId: "9", kind: "delta", text: "部分1" })
    // 等待防抖定时器
    await new Promise((r) => setTimeout(r, 80))
    const edits = calls.filter((c) => c.url.includes("/editMessageText"))
    expect(edits.length).toBe(1)
    expect(JSON.parse(edits[0].init!.body as string).message_id).toBe(88)
  })

  it("done 事件发送最终回复，超 4096 字符自动分段", async () => {
    const long = "x".repeat(5000)
    const { fn, calls } = mockFetch({ "/sendMessage": { ok: true, result: { message_id: 1 } } })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 })
    await adapter.send({ chatId: "9", kind: "done", text: long })
    const msgs = calls.filter((c) => c.url.includes("/sendMessage"))
    expect(msgs.length).toBe(2) // 5000 字符分两段
  })

  it("error 事件发送错误摘要", async () => {
    const { fn, calls } = mockFetch({ "/sendMessage": { ok: true, result: { message_id: 1 } } })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 })
    await adapter.send({ chatId: "9", kind: "error", text: "连不上" })
    const sm = calls.find((c) => c.url.includes("/sendMessage"))
    expect(JSON.parse(sm!.init!.body as string).text).toContain("连不上")
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: FAIL — `send` 仍是 not implemented

- [ ] **Step 3: 实现 send + 节流 + 分段**

在 `telegram.ts` 顶部常量区追加：

```typescript
const TELEGRAM_MSG_LIMIT = 4096
const TOOL_RESULT_LIMIT = 500
```

在 class 内把 `send` 替换为：

```typescript
  // 每个 chatId 的流式状态
  private streamState = new Map<string, { messageId?: number; buffer: string; editTimer?: ReturnType<typeof setTimeout> }>()

  private async sendText(chatId: string, text: string): Promise<number> {
    const res = await this.api<{ message_id: number }>("sendMessage", { chat_id: chatId, text })
    return res.message_id
  }

  private async editText(chatId: string, messageId: number, text: string): Promise<void> {
    await this.api("editMessageText", { chat_id: chatId, message_id: messageId, text }).catch(() => {})
  }

  // 超长文本分段发送，返回所有 messageId
  private async sendSegmented(chatId: string, text: string): Promise<void> {
    if (text.length <= TELEGRAM_MSG_LIMIT) {
      await this.sendText(chatId, text)
      return
    }
    for (let i = 0; i < text.length; i += TELEGRAM_MSG_LIMIT) {
      await this.sendText(chatId, text.slice(i, i + TELEGRAM_MSG_LIMIT))
    }
  }

  private flushEdit(chatId: string): void {
    const state = this.streamState.get(chatId)
    if (!state || state.editTimer == null || state.messageId == null) return
    const text = state.buffer || "…"
    state.editTimer = undefined
    void this.editText(chatId, state.messageId, text)
  }

  async send(event: OutgoingEvent): Promise<void> {
    const { chatId, kind } = event

    if (kind === "thinking") {
      const messageId = await this.sendText(chatId, "🤔 思考中...")
      this.streamState.set(chatId, { messageId, buffer: "" })
      return
    }

    if (kind === "delta") {
      const state = this.streamState.get(chatId) ?? { buffer: "" }
      state.buffer += event.text
      this.streamState.set(chatId, state)
      // 防抖：throttleMs 内只 edit 一次
      if (state.messageId != null && state.editTimer == null) {
        state.editTimer = setTimeout(() => this.flushEdit(chatId), this.throttleMs)
      }
      return
    }

    if (kind === "tool") {
      const icon = event.toolStatus === "start" ? "🔧" : "🔧"
      await this.sendText(chatId, `${icon} ${event.toolName ?? ""}${event.text ? `: ${event.text}` : ""}`)
      return
    }

    if (kind === "tool_result") {
      const ok = event.toolStatus === "error" ? "❌" : "✅"
      const detail = event.text.length > TOOL_RESULT_LIMIT ? event.text.slice(0, TOOL_RESULT_LIMIT) + "…" : event.text
      await this.sendText(chatId, `${ok} ${event.toolName ?? ""}${detail ? `\n${detail}` : ""}`)
      return
    }

    if (kind === "done") {
      // 刷掉未 edit 的残余
      this.flushEdit(chatId)
      this.streamState.delete(chatId)
      if (event.text) {
        await this.sendSegmented(chatId, event.text)
      }
      return
    }

    if (kind === "error") {
      this.streamState.delete(chatId)
      await this.sendText(chatId, `❌ ${event.text}`)
      return
    }
  }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: PASS（8 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/adapter/telegram.ts src/main/bridge/adapter/telegram.test.ts
git commit -m "feat: 实现 Telegram 发送节流与分段"
```

---

## Task 9: Telegram Adapter — 权限 inline keyboard

**Files:**
- Modify: `src/main/bridge/adapter/telegram.ts`
- Modify: `src/main/bridge/adapter/telegram.test.ts`

- [ ] **Step 1: 追加测试 — permission 事件发按钮**

在 `telegram.test.ts` 末尾追加：

```typescript
describe("TelegramAdapter 权限按钮", () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch as never
  })

  it("permission 事件发送带 inline keyboard 的消息", async () => {
    const { fn, calls } = mockFetch({ "/sendMessage": { ok: true, result: { message_id: 1 } } })
    globalThis.fetch = fn as never
    const adapter = new TelegramAdapter({ botToken: "t", throttleMs: 50 })
    await adapter.send({
      chatId: "9",
      kind: "permission",
      text: "🔐 bash: rm -rf x",
      permissionId: "perm-1",
      permissionSessionId: "sess-1",
    })
    const sm = calls.find((c) => c.url.includes("/sendMessage"))
    const body = JSON.parse(sm!.init!.body as string)
    expect(body.reply_markup.inline_keyboard).toEqual([
      [
        { text: "✅ 本次", callback_data: "once:sess-1:perm-1" },
        { text: "🔁 永久", callback_data: "always:sess-1:perm-1" },
        { text: "❌ 拒绝", callback_data: "reject:sess-1:perm-1" },
      ],
    ])
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: FAIL — permission 分支不存在

- [ ] **Step 3: 在 send 方法中追加 permission 分支**

在 `telegram.ts` 的 `send` 方法中，`error` 分支之前插入：

```typescript
    if (kind === "permission") {
      const sid = event.permissionSessionId ?? ""
      const pid = event.permissionId ?? ""
      await this.api("sendMessage", {
        chat_id: chatId,
        text: event.text,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ 本次", callback_data: `once:${sid}:${pid}` },
              { text: "🔁 永久", callback_data: `always:${sid}:${pid}` },
              { text: "❌ 拒绝", callback_data: `reject:${sid}:${pid}` },
            },
          ],
        },
      })
      return
    }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/adapter/telegram.test.ts`
Expected: PASS（9 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/adapter/telegram.ts src/main/bridge/adapter/telegram.test.ts
git commit -m "feat: 实现 Telegram 权限 inline keyboard"
```

---

## Task 10: Bridge Core — 会话映射 + 白名单 + 排队

**Files:**
- Create: `src/main/bridge/bridge.ts`
- Test: `src/main/bridge/bridge.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/main/bridge/bridge.test.ts`：

```typescript
import { describe, it, expect } from "vitest"
import { BridgeState } from "./bridge.js"

describe("BridgeState 会话映射与排队", () => {
  it("bindSession / getSession 基本映射", () => {
    const st = new BridgeState()
    st.bindSession("chat-1", "sess-1")
    expect(st.getSession("chat-1")).toBe("sess-1")
    expect(st.getChatId("sess-1")).toBe("chat-1")
  })

  it("rebind 切换会话后反向映射更新", () => {
    const st = new BridgeState()
    st.bindSession("chat-1", "sess-1")
    st.bindSession("chat-1", "sess-2")
    expect(st.getSession("chat-1")).toBe("sess-2")
    expect(st.getChatId("sess-1")).toBeUndefined()
    expect(st.getChatId("sess-2")).toBe("chat-1")
  })

  it("isAllowed 无白名单时全部放行", () => {
    const st = new BridgeState()
    expect(st.isAllowed(123)).toBe(true)
  })

  it("isAllowed 有白名单时只放行名单内", () => {
    const st = new BridgeState({ allowlist: [123] })
    expect(st.isAllowed(123)).toBe(true)
    expect(st.isAllowed(456)).toBe(false)
  })

  it("enqueue 在空闲时返回 null（无需排队）", () => {
    const st = new BridgeState()
    st.bindSession("chat-1", "sess-1")
    expect(st.enqueue("chat-1")).toBeNull()
    expect(st.isBusy("chat-1")).toBe(true)
  })

  it("enqueue 在忙碌时返回排队位置", () => {
    const st = new BridgeState()
    st.bindSession("chat-1", "sess-1")
    st.enqueue("chat-1") // 占用
    expect(st.enqueue("chat-1")).toBe(2)
  })

  it("enqueue 超过上限返回 -1", () => {
    const st = new BridgeState({ maxQueue: 2 })
    st.bindSession("chat-1", "sess-1")
    st.enqueue("chat-1")
    st.enqueue("chat-1")
    expect(st.enqueue("chat-1")).toBe(-1)
  })

  it("release 取出队列下一个并返回是否有后续", () => {
    const st = new BridgeState()
    st.bindSession("chat-1", "sess-1")
    st.enqueue("chat-1")
    st.enqueue("chat-1") // 排队第 2
    const next = st.release("chat-1")
    expect(next).toBe(true)
  })

  it("release 无后续时释放 busy 状态", () => {
    const st = new BridgeState()
    st.bindSession("chat-1", "sess-1")
    st.enqueue("chat-1")
    const next = st.release("chat-1")
    expect(next).toBe(false)
    expect(st.isBusy("chat-1")).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/bridge.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现（状态层）**

创建 `src/main/bridge/bridge.ts`：

```typescript
import type { IMAdapter, IncomingMessage, OutgoingEvent } from "./adapter/types.js"
import type { OpenCodeProxy } from "./proxy/opencode.js"
import { parseCommand, type Command } from "./router.js"

export interface BridgeOptions {
  allowlist?: number[]
  autoApprove?: boolean
  maxQueue?: number
}

// Bridge 的纯状态管理（可独立测试）
export class BridgeState {
  private chatToSession = new Map<string, string>()
  private sessionToChat = new Map<string, string>()
  private allowlist?: number[]
  private maxQueue: number
  // 每个 chat 的排队中 prompt 数量 + busy 标记
  private queueCount = new Map<string, number>()
  private busy = new Set<string>()

  constructor(options: BridgeOptions = {}) {
    this.allowlist = options.allowlist
    this.maxQueue = options.maxQueue ?? 5
  }

  bindSession(chatId: string, sessionId: string): void {
    const old = this.chatToSession.get(chatId)
    if (old) this.sessionToChat.delete(old)
    this.chatToSession.set(chatId, sessionId)
    this.sessionToChat.set(sessionId, chatId)
  }

  getSession(chatId: string): string | undefined {
    return this.chatToSession.get(chatId)
  }

  getChatId(sessionId: string): string | undefined {
    return this.sessionToChat.get(sessionId)
  }

  isAllowed(userId: number): boolean {
    if (!this.allowlist || this.allowlist.length === 0) return true
    return this.allowlist.includes(userId)
  }

  // 返回 null=直接执行，数字=排队位置，-1=队列满
  enqueue(chatId: string): number | null {
    if (!this.busy.has(chatId)) {
      this.busy.add(chatId)
      return null
    }
    const count = this.queueCount.get(chatId) ?? 0
    if (count >= this.maxQueue) return -1
    this.queueCount.set(chatId, count + 1)
    return count + 2 // 排队位置（含当前正在执行的）
  }

  isBusy(chatId: string): boolean {
    return this.busy.has(chatId)
  }

  // 释放当前任务，返回 true=队列里还有下一个要执行
  release(chatId: string): boolean {
    const count = this.queueCount.get(chatId) ?? 0
    if (count > 0) {
      this.queueCount.set(chatId, count - 1)
      return true // 仍有 busy，下一个继续
    }
    this.queueCount.delete(chatId)
    this.busy.delete(chatId)
    return false
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/bridge.test.ts`
Expected: PASS（10 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/bridge.ts src/main/bridge/bridge.test.ts
git commit -m "feat: 实现 Bridge 状态管理与排队"
```

---

## Task 11: Bridge Core — 路由串联（消息→控制 + 事件→推送）

**Files:**
- Modify: `src/main/bridge/bridge.ts`
- Modify: `src/main/bridge/bridge.test.ts`

- [ ] **Step 1: 追加测试 — 指令路由**

在 `bridge.test.ts` 末尾追加（用 mock adapter + mock proxy）：

```typescript
import { vi } from "vitest"
import type { IMAdapter, IncomingMessage, OutgoingEvent } from "./adapter/types.js"
import type { OpenCodeProxy } from "./proxy/opencode.js"

function makeMocks() {
  const sent: OutgoingEvent[] = []
  const adapter: IMAdapter = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(async (e: OutgoingEvent) => sent.push(e)),
  }
  const proxy: OpenCodeProxy = {
    createSession: vi.fn().mockResolvedValue("sess-new"),
    listSessions: vi.fn().mockResolvedValue([{ id: "s1", title: "T1" }]),
    getSession: vi.fn().mockResolvedValue({ id: "s1", model: { id: "claude" } }),
    abort: vi.fn().mockResolvedValue(undefined),
    promptAsync: vi.fn().mockResolvedValue(undefined),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  } as unknown as OpenCodeProxy
  return { adapter, proxy, sent }
}

describe("Bridge 路由", () => {
  it("/new 创建会话并绑定，回复确认", async () => {
    const { adapter, proxy, sent } = makeMocks()
    const bridge = new Bridge(adapter, proxy, { autoApprove: false })
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "/new" })
    expect(proxy.createSession).toHaveBeenCalled()
    expect(sent.some((e) => e.kind === "done" && e.text.includes("sess-new"))).toBe(true)
  })

  it("普通文本作为 prompt 发送", async () => {
    const { adapter, proxy } = makeMocks()
    const bridge = new Bridge(adapter, proxy, {})
    bridge.bindSession("c1", "s1")
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "写测试" })
    expect(proxy.promptAsync).toHaveBeenCalledWith("s1", "写测试")
  })

  it("未绑定时发文本自动 /new", async () => {
    const { adapter, proxy } = makeMocks()
    const bridge = new Bridge(adapter, proxy, {})
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "hello" })
    expect(proxy.createSession).toHaveBeenCalled()
  })

  it("/abort 中止当前会话", async () => {
    const { adapter, proxy } = makeMocks()
    const bridge = new Bridge(adapter, proxy, {})
    bridge.bindSession("c1", "s1")
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "/abort" })
    expect(proxy.abort).toHaveBeenCalledWith("s1")
  })

  it("callback once 调用 respondPermission(once)", async () => {
    const { adapter, proxy } = makeMocks()
    const bridge = new Bridge(adapter, proxy, { autoApprove: false })
    await bridge.handleMessage({ chatId: "c1", userId: 1, text: "", callbackData: "once:s1:p1" })
    expect(proxy.respondPermission).toHaveBeenCalledWith("s1", "p1", "once")
  })

  it("autoApprove=true 时自动通过权限(always)", async () => {
    const { adapter, proxy } = makeMocks()
    const bridge = new Bridge(adapter, proxy, { autoApprove: true })
    bridge.bindSession("c1", "s1")
    // 模拟 proxy 事件回流
    bridge.handleProxyEvent({ chatId: "c1", kind: "permission", text: "🔐 bash", permissionId: "p1", permissionSessionId: "s1" })
    await new Promise((r) => setTimeout(r, 0))
    expect(proxy.respondPermission).toHaveBeenCalledWith("s1", "p1", "always")
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun run test -- src/main/bridge/bridge.test.ts`
Expected: FAIL — `Bridge` class 不存在

- [ ] **Step 3: 实现 Bridge class**

在 `bridge.ts` 末尾追加（`BridgeState` class 之后）：

```typescript
// Bridge 中枢：串联 adapter/proxy，处理路由
export class Bridge {
  private state: BridgeState
  private autoApprove: boolean
  private stopProxy: (() => void) | null = null

  constructor(
    private adapter: IMAdapter,
    private proxy: OpenCodeProxy,
    options: BridgeOptions = {},
  ) {
    this.state = new BridgeState(options)
    this.autoApprove = options.autoApprove ?? false
  }

  // 暴露给测试的便捷方法
  bindSession(chatId: string, sessionId: string): void {
    this.state.bindSession(chatId, sessionId)
  }

  // 启动：连接 adapter 收消息 + proxy 订阅事件
  async start(): Promise<void> {
    await this.adapter.start((msg) => {
      void this.handleMessage(msg)
    })
    // 用 getter 函数实时查询，确保 /new /switch 新绑定后事件不丢
    this.stopProxy = this.proxy.subscribe(
      (sessionId) => this.state.getChatId(sessionId),
      (event) => this.handleProxyEvent(event),
    )
  }

  async stop(): Promise<void> {
    await this.adapter.stop()
    this.stopProxy?.()
  }

  // 处理 IM 来的消息
  async handleMessage(msg: IncomingMessage): Promise<void> {
    if (!this.state.isAllowed(msg.userId)) return

    // callback query（权限按钮）
    if (msg.callbackData) {
      await this.handleCallback(msg.callbackData)
      return
    }

    const cmd = parseCommand(msg.text)
    await this.dispatch(msg.chatId, cmd)
  }

  private async dispatch(chatId: string, cmd: Command): Promise<void> {
    switch (cmd.kind) {
      case "new": {
        const sid = await this.proxy.createSession()
        this.state.bindSession(chatId, sid)
        await this.adapter.send({ chatId, kind: "done", text: `✅ 新会话已创建: ${sid}` })
        return
      }
      case "list": {
        const list = await this.proxy.listSessions()
        const text = list.map((s) => `- ${s.id}${s.title ? ` (${s.title})` : ""}`).join("\n") || "（无会话）"
        await this.adapter.send({ chatId, kind: "done", text: text })
        return
      }
      case "switch": {
        if (!cmd.sessionId) {
          await this.adapter.send({ chatId, kind: "error", text: "用法: /switch <id>" })
          return
        }
        this.state.bindSession(chatId, cmd.sessionId)
        await this.adapter.send({ chatId, kind: "done", text: `✅ 已切换到: ${cmd.sessionId}` })
        return
      }
      case "abort": {
        const sid = this.state.getSession(chatId)
        if (!sid) {
          await this.adapter.send({ chatId, kind: "error", text: "当前无绑定会话" })
          return
        }
        await this.proxy.abort(sid)
        await this.adapter.send({ chatId, kind: "done", text: "⏹ 已中止" })
        return
      }
      case "status": {
        const sid = this.state.getSession(chatId)
        if (!sid) {
          await this.adapter.send({ chatId, kind: "done", text: "未绑定会话，发 /new 创建" })
          return
        }
        const info = await this.proxy.getSession(sid)
        const model = (info as { model?: { id?: string } }).model?.id ?? "unknown"
        await this.adapter.send({ chatId, kind: "done", text: `会话: ${sid}\n模型: ${model}` })
        return
      }
      case "help": {
        await this.adapter.send({
          chatId,
          kind: "done",
          text: "命令: /new /list /switch <id> /abort /status\n普通文本=发 prompt",
        })
        return
      }
      case "prompt": {
        await this.handlePrompt(chatId, cmd.text)
        return
      }
    }
  }

  private async handlePrompt(chatId: string, text: string): Promise<void> {
    let sid = this.state.getSession(chatId)
    if (!sid) {
      sid = await this.proxy.createSession()
      this.state.bindSession(chatId, sid)
    }

    const pos = this.state.enqueue(chatId)
    if (pos === -1) {
      await this.adapter.send({ chatId, kind: "error", text: "⚠️ 队列已满，请稍后" })
      return
    }
    if (pos !== null) {
      await this.adapter.send({ chatId, kind: "done", text: `⏳ 已排队（第 ${pos} 位）` })
      return
    }
    await this.proxy.promptAsync(sid, text)
  }

  private async handleCallback(data: string): Promise<void> {
    // 格式: once:sessionId:permissionId / always:... / reject:...
    const [response, sessionId, permissionId] = data.split(":")
    if (response !== "once" && response !== "always" && response !== "reject") return
    await this.proxy.respondPermission(sessionId, permissionId, response)
  }

  // 处理 proxy 回流的事件 → 推给 adapter
  handleProxyEvent(event: OutgoingEvent): void {
    // autoApprove：权限自动通过（用 always=永久允许，避免同一会话反复弹窗）
    if (event.kind === "permission" && this.autoApprove) {
      const sid = event.permissionSessionId
      const pid = event.permissionId
      if (sid && pid) {
        void this.proxy.respondPermission(sid, pid, "always")
        return // 不推给 IM，静默通过
      }
    }

    // done 事件：释放排队
    if (event.kind === "done") {
      const chatId = event.chatId
      const hasNext = this.state.release(chatId)
      if (hasNext) {
        void this.adapter.send({ chatId, kind: "done", text: "⏭ 继续下一条排队消息..." })
      }
    }

    void this.adapter.send(event)
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun run test -- src/main/bridge/bridge.test.ts`
Expected: PASS（16 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/bridge/bridge.ts src/main/bridge/bridge.test.ts
git commit -m "feat: 实现 Bridge 路由串联与事件回流"
```

---

## Task 12: app 集成 — paths + main.ts + preload IPC

**Files:**
- Modify: `src/main/paths.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: paths.ts 加 bridgeConfigPath**

在 `paths.ts` 的 `AppPaths` 接口加字段：

```typescript
export interface AppPaths {
  configPath: string
  jsonlPath: string
  ingestPath: string
  sqlitePath: string
  pluginPath: string
  pluginSharedPath: string
  bundledPluginPath: string
  bundledPluginSharedPath: string
  bridgeConfigPath: string   // 新增
}
```

在 `resolveAppPaths` 返回对象里加：

```typescript
    bridgeConfigPath: join(tokenMetricsPath, "bridge.json"),
```

（加在 `pluginSharedPath` 行之后）

- [ ] **Step 2: main.ts 集成 bridge 生命周期**

在 `main.ts` 顶部 import 区追加：

```typescript
import { readBridgeConfig } from "./bridge/config.js"
import { TelegramAdapter } from "./bridge/adapter/telegram.js"
import { OpenCodeProxy } from "./bridge/proxy/opencode.js"
import { Bridge } from "./bridge/bridge.js"
```

在 `AppState` 接口追加字段：

```typescript
  bridge: Bridge | null
```

在 `state` 初始值追加：

```typescript
  bridge: null,
```

在 `app.whenReady().then(...)` 回调内，`watchMetricEvents()` 之后、`ipcMain.handle` 区块之前追加 bridge 启动逻辑：

```typescript
  // 远程桥接：读配置，有效才启动
  if (state.paths) {
    const bridgeCfg = readBridgeConfig(state.paths.bridgeConfigPath)
    if (bridgeCfg) {
      try {
        const tgAdapter = new TelegramAdapter({
          botToken: bridgeCfg.telegram.botToken,
          throttleMs: bridgeCfg.throttleMs,
        })
        await tgAdapter.verifyToken()
        await tgAdapter.registerCommands()
        const proxy = OpenCodeProxy.fromBaseUrl(bridgeCfg.opencode.baseUrl)
        state.bridge = new Bridge(tgAdapter, proxy, {
          allowlist: bridgeCfg.allowlist,
          autoApprove: bridgeCfg.autoApprove,
        })
        await state.bridge.start()
        console.log("Bridge started")
      } catch (error) {
        console.warn("Failed to start bridge", error)
        state.bridge = null
      }
    }
  }
```

在 `before-quit` 的异步清理块内，`state.ingestServer?.stop()` 之后追加：

```typescript
        try {
          await state.bridge?.stop()
        } catch (error) {
          console.warn("Failed to stop bridge", error)
        } finally {
          state.bridge = null
        }
```

在 `ipcMain.handle` 区块末尾追加 bridge IPC：

```typescript
  ipcMain.handle("bridge:status", () => ({ running: state.bridge != null }))
```

- [ ] **Step 3: preload.ts 暴露 bridge status**

在 `preload.ts` 的 `tokenMetrics` 对象内追加：

```typescript
  getBridgeStatus: () => ipcRenderer.invoke("bridge:status"),
```

- [ ] **Step 4: 运行全量测试验证无回归**

Run: `bun run test`
Expected: 所有测试 PASS（原有测试 + 新增 bridge 测试）

- [ ] **Step 5: 构建验证**

Run: `bun run build`
Expected: 构建成功，无类型错误

- [ ] **Step 6: 手动冒烟测试（需真实 Telegram bot token + 运行中的 OpenCode）**

1. 创建 `~/.config/opencode/token-metrics/bridge.json`，填入 bot token
2. `bun run dev` + `bun run dev:app`
3. 在 Telegram 给 bot 发 `/new` → 应回复会话 id
4. 发普通文本 → 应收到流式回复（占位消息逐步更新）
5. 发 `/abort` → 应中止
6. 触发一次需要权限的操作 → 应收到 inline keyboard，点按钮生效

- [ ] **Step 7: 提交**

```bash
git add src/main/paths.ts src/main/main.ts src/main/preload.ts
git commit -m "feat: 集成远程桥接到主进程"
```

---

## 完成标志

全部 12 个任务完成后：

1. `bun run test` 全绿
2. `bun run build` 成功
3. 配置 `bridge.json` 后，Telegram bot 可远程控制 OpenCode（发 prompt、查看回复、中止、权限批准）
4. 无配置时不启动 bridge，现有 token 统计功能不受影响

## 后续（不在本 plan 范围）

- renderer 设置面板 UI（填写 bot token 的表单）
- 飞书 / QQ adapter
- 会话映射持久化到磁盘
- 多 OpenCode 实例
