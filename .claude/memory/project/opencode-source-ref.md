# OpenCode 源码参考

## 源码位置

OpenCode 源码克隆在同级目录：`../opencode`（即 `/Users/fcw/project/js/opencode`）。

## 实现规则

**涉及 OpenCode API、事件、类型、协议时，必须查源码确认，不要猜测。**

## 关键包

| 包 | 路径 | 用途 |
|---|---|---|
| 核心 | `packages/opencode/` | session/permission/tool/server 路由等核心逻辑 |
| v1 schema | `packages/core/src/v1/` | 事件定义、Part/Message/Permission schema |
| JS SDK | `packages/sdk/js/` | `@opencode-ai/sdk` 客户端，`src/gen/sdk.gen.ts` 是所有方法 |
| HTTP server | `packages/server/` | 路由定义（如要确认可改为查这里） |
| Slack 参考 | `packages/slack/src/index.ts` | 官方 SSE 消费示例，最佳参考 |

## 已核实的关键事实（2026-06-17）

### SSE 事件订阅

- `client.global.event()` 返回 `{ stream: AsyncGenerator }`（不是 `data`）
- 迭代方式：`for await (const entry of sse.stream)`
- `/global/event` 流每个 yield：`{ directory, payload: { id, type, properties } }`
- `/event` 流每个 yield：`{ id, type, properties }`
- 字段名是 `type` + `properties`（不是 `data`）
- 参考消费代码：`packages/slack/src/index.ts:24-38`

### SSE 事件 type 值（来自 `packages/core/src/v1/session.ts` 等）

| type | 说明 |
|---|---|
| `session.status` | 会话状态，`properties.status` = `"busy"` / `"idle"` / `"retry"` |
| `message.part.delta` | 流式增量，`properties.delta` 是字符串 |
| `message.part.updated` | 消息部分更新，`properties.part` 含 `{ type, ... }`（text/tool 等） |
| `message.updated` / `message.removed` | 消息级事件 |
| `permission.asked` | 权限请求，`properties` = `{ id, permission, metadata, sessionID, ... }` |
| `permission.replied` | 权限已响应 |

**注意**：`tool.execute.before/after` 是**插件钩子**（`plugin.trigger`），不是 SSE 事件。工具状态通过 `message.part.updated`（`part.type === "tool"`）传递。

### prompt / promptAsync body

- `POST /session/{id}/message`（prompt）和 `POST /session/{id}/prompt_async`（promptAsync）共用 body schema
- 最小合法 body：`{ parts: [{ type: "text", text: "..." }] }`
- `parts` 是唯一必填顶层字段
- 定义：`packages/opencode/src/session/prompt.ts:1594`（PromptInput）

### 权限响应 body

- `POST /session/{id}/permissions/{permissionID}`（已 deprecated）
- body：`{ response: "once" | "always" | "reject" }`（三态字符串，不是布尔）
- 新端点：`POST /permission/{requestID}/reply`，body `{ reply: "once"|"always"|"reject", message? }`
- 定义：`packages/core/src/v1/permission.ts:42`（Reply = Literals(["once","always","reject"])）

### session 控制端点

| 方法 | SDK 调用 | 端点 |
|---|---|---|
| 创建 | `client.session.create()` | `POST /session` → `{ data: { id, ... } }` |
| 列表 | `client.session.list()` | `GET /session` |
| 详情 | `client.session.get({ path: { id } })` | `GET /session/{id}` |
| 中止 | `client.session.abort({ path: { id } })` | `POST /session/{id}/abort` |
| 发消息 | `client.session.promptAsync({ path: { id }, body })` | `POST /session/{id}/prompt_async` |
