# IM Bridge Remote Control Design

## Goal

为 OpenCode Token Menubar 增加远程桥接能力：用户通过 IM（首期 Telegram）实时查看 OpenCode 状态，并远程向 OpenCode 会话发送 prompt、中止任务、批准权限请求。

app 作为 OpenCode 的"远程代理"，内置 OpenCode 官方 Client SDK，把 IM 消息翻译成 SDK 调用，把 OpenCode 事件流推回 IM。

## Chosen Approach

**方案 B：单进程 + 模块化 adapter 抽象。**

在 Electron 主进程内新增三层清晰边界的模块，首期实现 Telegram adapter，后续 IM 平台只需实现 `IMAdapter` 接口。

关键决策：

- **控制走 Client SDK，不走插件**。OpenCode 插件 SDK 是被动 hook（event/tool/permission），没有主动驱动会话的 API。强行用插件做反向控制会很 hack。OpenCode 官方在 `packages/sdk` 暴露了完整的 HTTP API 客户端（`@opencode-ai/sdk`），是外部驱动的正确路径。
- **节流策略下沉到 Adapter 层**。只有 Adapter 知道自己平台的连接方式（全双工 vs 轮询）和发送侧速率限制。Bridge Core 只递交事件，不关心节流。
- **纯增量，默认关闭**。无配置不启动，不影响现有 token 统计主功能。

## Architecture

### 三层边界 + 数据流

```
┌─────────────────────────────────────────────────────────────┐
│  Electron 主进程 (现有 menubar app，常驻)                      │
│                                                               │
│   ┌──────────────┐    指令    ┌──────────────┐   SDK 调用    ┌────────────────┐
│   │  IM Adapter  │ ─────────→ │  Bridge Core │ ──────────→  │ OpenCode Proxy │
│   │  层          │            │  (中枢)      │              │ (Client SDK)   │
│   │              │ ←───────── │              │ ←──────────  │                │
│   │ Telegram首期 │   推送     │ 会话映射/    │   事件流      │ session.* /    │
│   │ 飞书/QQ 后续 │            │ 路由/排队    │              │ GlobalEvent    │
│   └──────┬───────┘            └──────────────┘              └───────┬────────┘
└──────────┼───────────────────────────────────────────────────┼──────┘
           │                                                   │
     长轮询 / webhook                              HTTP + SSE
           ▼                                                   ▼
     ┌──────────────┐                               ┌───────────────────┐
     │ Telegram Bot │                               │ 本地 OpenCode 实例 │
     │ API          │                               │ (localhost:4096)  │
     └──────────────┘                               └───────────────────┘
```

### 组件职责

| 组件 | 职责 | 不做什么 |
|---|---|---|
| **IM Adapter 层** | 连接 IM 平台、收消息、发消息、节流/防抖。只懂 IM 协议。 | 不解析指令语义、不知道 session 存在 |
| **Bridge Core** | 中枢：指令路由（`/new` vs 普通文本）、`chatId↔sessionId` 映射、消息排队、白名单过滤。 | 不直接调 SDK、不直接连 IM |
| **OpenCode Proxy** | 封装 Client SDK：`SessionCreate`/`SessionPromptAsync`/`SessionAbort` + 订阅 `GlobalEvent`。 | 不懂 IM、不做路由 |

### 模块文件结构

```
src/main/bridge/
  adapter/
    types.ts        # IMAdapter 接口（收消息回调、发消息方法、生命周期）
    telegram.ts     # TelegramAdapter（长轮询 getUpdates）
  proxy/
    opencode.ts     # OpenCode Proxy（SDK 封装 + 事件订阅）
  bridge.ts         # Bridge Core（路由、会话映射、排队）
  config.ts         # 凭证读取（仿现有 ingest.json 模式）
  router.ts         # 指令解析（/new /abort /list /switch...）
```

## Configuration

仿现有 `ingest.json` 模式，放 `~/.config/opencode/token-metrics/bridge.json`：

```jsonc
{
  "telegram": {
    "botToken": "123456:ABC-DEF..."          // 从 @BotFather 获取
  },
  "opencode": {
    "baseUrl": "http://localhost:4096"        // 默认值，OpenCode 实际端口
  },
  "allowlist": [123456789],                    // 可选：Telegram user id 白名单
                                               // 空/缺省 = 全放行（"直接转发"）
  "autoApprove": false,                        // 可选：权限请求是否自动通过
                                               // false（默认）= 转发到 IM 等用户点按钮
  "throttleMs": 1500                           // 可选：Adapter 节流间隔，默认 1500ms
}
```

**配置来源**：首期支持手动编辑文件。后续在 renderer 设置面板加表单（通过 IPC 写入，和现有 `ingest.json` 的写入方式一致）。UI 是必需项，但首期先用文件，避免范围膨胀。

## Telegram Command Protocol

启动 adapter 时调用 `setMyCommands` 注册菜单，用户输入框点 `/` 直接看到命令列表：

| 命令 | 动作 | 对应 SDK 调用 |
|---|---|---|
| `/new` | 新建 OpenCode 会话，绑定到当前 chat | `SessionCreate` |
| `/list` | 列出会话（当前 chat 绑定的 + 全部） | `SessionList` |
| `/switch <id>` | 切换当前 chat 绑定的会话 | 本地映射更新 |
| `/abort` | 中止当前会话正在跑的任务 | `SessionAbort` |
| `/status` | 看当前绑定：session id、模型、本次 token 用量 | `SessionGet` + token 统计 |
| `/help` | 帮助 | — |

**普通文本消息**（非 `/` 开头）→ 直接作为 prompt 发给当前绑定的 session（`SessionPromptAsync`）。首次在某个 chat 发文本且未绑定 session 时，自动 `/new` 一个。

## Session Mapping

Bridge Core 维护一张内存表（可后续持久化）：

```
chatId (number) → sessionId (string) + lastActiveAt
```

- 每个 Telegram chat（私聊/群）独立绑定一个 OpenCode session
- `/new` 会新建并重新绑定（旧 session 保留在 OpenCode 侧，`/switch` 能切回）
- 群聊场景：默认只响应 `/` 命令 + @bot 的文本，避免噪音

### 白名单过滤

收到消息时，Bridge 先查 `allowlist`：

- 未配置 → 全放行（默认，"直接转发"）
- 配置了 → 只处理白名单内 user id 的消息，其余静默丢弃

## Event Mapping

`GlobalEvent` 订阅 → `OutgoingEvent` 映射：

Proxy 订阅 SSE 事件流（`client.global.event()`，`GET /global/event` Server-Sent Events），按当前各 chat 绑定的 `sessionId` 过滤，转成 `OutgoingEvent` 丢给 Bridge：

| OpenCode 原始事件 | → OutgoingEvent | 说明 |
|---|---|---|
| session 首个 assistant delta | `thinking` | 触发发占位消息 |
| `message.part.delta`（文本） | `delta` | 流式文本，Adapter 节流 |
| `tool.execute.before` | `tool` (start) | `🔧 bash: npm test` |
| `tool.execute.after` | `tool_result` | `✅/❌` + 结果摘要（超长截断 ~500 字符 + `…`） |
| message 完成 | `done` | Adapter 定型占位消息 |
| permission 请求 | 见下方权限交互 | 危险操作授权 |
| 错误/异常 | `error` | `❌ <摘要>` |

### OutgoingEvent 接口

```ts
interface OutgoingEvent {
  chatId: string;
  kind: "thinking" | "delta" | "tool" | "tool_result" | "done" | "error" | "permission";
  text: string;
  sessionId?: string;
  // permission / tool 携带的额外字段
  toolName?: string;
  toolStatus?: "start" | "success" | "error";
  permissionId?: string;
}
```

## Permission Handling

OpenCode 执行危险操作（写文件、跑 bash）时会发 **permission 请求**。远程控制时必须能让用户在 IM 里批准/拒绝。

Telegram 支持 **inline keyboard 按钮**：

```
🔐 权限请求
bash: rm -rf node_modules
会话: a1b2c3

  [✅ 允许]   [❌ 拒绝]
```

用户点按钮 → Telegram callback → Bridge 调 `respondPermission(sessionId, permissionId, decision)`。

### autoApprove 配置

- `false`（默认）：每次权限请求都转发到 IM，inline keyboard 等用户授权。符合"远程控制"的谨慎。
- `true`：所有权限请求自动通过，IM 只收到通知不卡流程。适合信任模式 + 长任务无人值守。

遵循 OpenCode 自己的权限模型：OpenCode 需要授权就提示授权；`autoApprove=true` 时 OpenCode 请求权限就自动通过。

## Concurrency

| 场景 | 策略 |
|---|---|
| 同一 chat 连发多条文本 | **排队**：消息入队（FIFO），收到时回 `"⏳ 已排队（第 N 位）"`；当前 prompt 完成（`done` 事件）后自动取下一条执行 |
| 队列上限 | 每 chat 队列上限 5，超过则拒绝并提示 `"⚠️ 队列已满，请稍后"`，防刷屏 |
| 同一 session 多个 chat 绑定 | 首期不支持（`chatId↔sessionId` 是 1:1 映射） |
| OpenCode 正在跑时 `/abort` | 直接调 `SessionAbort`，中断当前流 |

## Error Handling

所有错误**不传播到 app 主进程崩溃**——bridge 是 app 内可选模块，挂了不影响 token 统计主功能。

| 来源 | 表现 |
|---|---|
| Telegram API 429 限流 | Adapter 内部指数退避，重试 3 次仍失败则放弃该条，不崩 bridge |
| Telegram token 无效 | 启动时校验 `getMe`，失败则 bridge 不启动，renderer 报错提示 |
| OpenCode 连不上 | Bridge 状态"未连接"，IM 收消息回 `"⚠️ OpenCode 未运行"`，后台定期重试连 |
| SDK 调用异常 | 捕获后回 `"❌ <错误摘要>"`，不传播到 bridge 崩溃 |
| 配置文件缺失/格式错 | Bridge 不启动，renderer 提示去配置 |

### Server 发现与容错

| 场景 | 处理 |
|---|---|
| 默认连 `http://localhost:4096` | 配置可覆盖 `baseUrl` |
| 连不上 | Bridge 状态"未连接"，后台定期重试 |
| SSE 断线 | 指数退避重连（1s→2s→4s…封顶 30s），重连成功后重新订阅事件流 |
| 多个 OpenCode 实例 | 首期只支持单实例（配的哪个 `baseUrl` 就连哪个） |

## Streaming / Throttle Strategy

节流策略下沉到 Adapter 层，由各 Adapter 根据自身平台能力实现。Bridge Core 对外只调统一的 `send(event)`。

### IMAdapter 接口

```ts
export interface IMAdapter {
  start(onMessage: (msg: IncomingMessage) => void): Promise<void>;
  stop(): Promise<void>;

  // Bridge 统一调这个；节流/流式由 Adapter 内部处理
  send(event: OutgoingEvent): Promise<void>;
}
```

### Telegram Adapter 节流策略

Telegram 是 HTTP 轮询 + HTTP 发送，两个方向都受限：

| 阶段 | 行为 | 控制项 |
|---|---|---|
| 收到 `thinking` | 发占位消息 `"🤔 思考中..."`，记下 `message_id` | — |
| 收到 `delta` | 内部 buffer 累积文本，**防抖 `throttleMs`** 用 `editMessageText` 更新同一条消息 | 间隔 ≥ `throttleMs`（默认 1500ms），规避 429 |
| 收到 `tool` | 精简推送一行 `"🔧 bash: npm test"`，单独消息 | 工具调用本身离散，不刷屏 |
| 收到 `tool_result` | 推 `"✅/❌ <工具名> <状态>"` + 结果摘要（截断 ~500 字符） | — |
| 收到 `done` | 发最终完整回复；超 4096 字符（Telegram 单条上限）自动分段 `sendMessage` | — |
| 收到 `error` | 发 `"❌ <错误摘要>"` | — |

核心是：**一条占位消息边攒边 edit，完成时定型**。

### 未来流式 IM 的对比

同样的 `send(event)` 接口，流式 IM（如飞书长连接）收到 `delta` 直接往长连接写，不做 buffer——因为发送侧没有 HTTP 那种严苛限流。**接口不变，实现各异**。

## Testing

沿用现有 `*.test.ts` + vitest 模式：

```
adapter/telegram.test.ts     # mock Telegram API，测节流/防抖/offset 管理
proxy/opencode.test.ts       # mock OpencodeClient，测事件映射、重连
bridge.test.ts               # mock Adapter + Proxy，测路由/会话映射/排队
router.test.ts               # 指令解析纯函数，最好测
```

参考现有 `ingestServer.test.ts` 的 mock 风格。重点测**节流定时器**和**事件映射**这两个容易出 bug 的地方。

## App Integration

| 集成点 | 做法 |
|---|---|
| `main.ts` 启动 | 读 `bridge.json`，存在且有效才启动 bridge；不存在则跳过（不影响主功能） |
| renderer 开关 | 设置面板加"远程桥接"开关 + 状态指示灯（未连接 / 已连接 Telegram / 已连接 OpenCode） |
| IPC | `bridge:start` / `bridge:stop` / `bridge:status`，preload 暴露 |
| token 统计功能 | **完全不受影响**，现有 `token-metrics` 插件和 ingest server 照常 |

## Out of Scope

以下不在本次 spec 范围内，留给后续迭代：

- 飞书 / QQ adapter 实现（接口预留，实现另立 spec）
- 配置 UI 表单（首期用配置文件，UI 后续加）
- 多 OpenCode 实例同时桥接
- 会话映射的磁盘持久化（首期内存表，重启后 chat 重新绑定 session）
- 群聊的细粒度权限模型（首期只做 @bot 响应过滤）
- 消息去重（首期靠 Telegram offset 管理，不额外做应用层去重）
