# Multi-Instance Registry & Bridge Design

## Goal

支持自动发现和管理本机多个 OpenCode 实例（5-6 个），通过 Telegram 远程切换并操控任意实例的会话。

## Chosen Approach

**端口范围扫描 + 全局当前实例切换**。

- 启动时 + 定期扫描端口范围（默认 4096-4112），探活 `/config` 发现 OpenCode 实例
- 自动维护实例注册表（上线/下线）
- Telegram 用 `/instance` 列出实例、`/instance <N>` 切换"当前实例"
- 切换后所有命令（`/new` `/list` `/abort` /prompt）作用于当前实例
- 每个 chat 的 session 映射扩展为 `instanceId → sessionId`，切换实例时恢复该实例上次的 session

## Architecture

### 当前（单实例）

```
Telegram Adapter ←→ Bridge ←→ OpenCodeProxy ←→ 单个 OpenCode
                     ↑ 单个 subscribe
```

### 改造后（多实例）

```
Telegram Adapter ←→ Bridge ←→ InstanceRegistry（扫描/注册表）
                     ↓                    ↓
                     ↓          ┌─────────┼─────────┐
                     ↓          ↓         ↓         ↓
                     ←→ Proxy1  Proxy2  Proxy3  ...
                            ←→  ←→    ←→
                         OC:4096 OC:4097 OC:4098 ...
```

Bridge 不再持有单个 Proxy，而是通过 InstanceRegistry 管理多个 Proxy。每个在线实例独立 subscribe SSE。

### 新增模块

```
src/main/bridge/
  instanceRegistry.ts + test    # 端口扫描 + 实例注册表 + 定期轮询
```

### 修改模块

```
  bridge.ts                      # 状态管理扩展（多实例 session 映射 + 当前实例切换）
  router.ts                      # 加 /instance 命令
  config.ts                      # 加扫描范围/间隔配置
  main.ts                        # 启动 InstanceRegistry
```

## Instance Discovery

### 扫描机制

```typescript
export interface InstanceEntry {
  port: number;              // 端口号，同时作为唯一 id
  baseUrl: string;           // http://localhost:<port>
  status: "online" | "offline";
  firstSeenAt: number;       // 首次发现时间戳
  title?: string;            // 实例标题（从 /config 或 session 推断，尽力而为）
}
```

扫描流程（并行）：
1. 遍历端口范围（默认 4096-4112，16 个端口）
2. 每个端口 `GET /config`（`AbortSignal.timeout(1500)`）
3. 成功 = OpenCode 实例 → 标记 online
4. 失败 = 无实例 → 跳过

### InstanceRegistry 类

```typescript
export class InstanceRegistry {
  private instances = new Map<number, InstanceEntry>();
  private proxies = new Map<number, OpenCodeProxy>();
  private timer?: ReturnType<typeof setInterval>;
  
  constructor(options: { scanStart: number; scanEnd: number; scanIntervalMs: number }) {}
  
  // 启动定期扫描，onUpdate 在实例列表变化时回调
  start(onUpdate: (instances: InstanceEntry[]) => void): void
  stop(): void
  
  // 手动触发一次扫描（测试用）
  async scan(): Promise<InstanceEntry[]>
  
  // 获取当前在线实例列表
  getInstances(): InstanceEntry[]
  
  // 获取指定实例的 Proxy（自动创建+缓存）
  getProxy(port: number): OpenCodeProxy
  
  // 按序号获取（Telegram /instance N 用）
  getByIndex(index: number): InstanceEntry | undefined
}
```

### 配置扩展

`bridge.json` 新增可选字段：

```jsonc
{
  "telegram": { "botToken": "..." },
  "scan": {
    "start": 4096,        // 默认 4096
    "end": 4112,          // 默认 4112
    "intervalMs": 30000   // 默认 30000
  }
}
```

## Bridge 多实例状态管理

### 状态扩展

```typescript
// 当前（单实例）
chatToSession: Map<string, string>  // chatId → sessionId

// 改造后（多实例）
interface ChatBinding {
  currentInstancePort: number;                    // 当前操作的实例
  sessions: Map<number, string>;                  // instancePort → sessionId
}
chatBindings: Map<string, ChatBinding>            // chatId → binding
```

### 切换实例逻辑

`/instance 2`：
1. 从 InstanceRegistry 获取第 2 个实例
2. 更新 `chatBindings[chatId].currentInstancePort`
3. 查 `sessions.get(instancePort)` 是否有绑定的 session
4. 有 → 回复 `✅ 切换到 :4097（会话: xxx）`
5. 无 → 回复 `✅ 切换到 :4097（无绑定会话，发 /new 创建）`

### 命令路由变化

Bridge.dispatch 里的所有命令改为先获取当前实例的 Proxy + sessionId：

```typescript
private getCurrentProxy(chatId: string): { proxy: OpenCodeProxy; sessionId?: string } | null {
  const binding = this.chatBindings.get(chatId);
  if (!binding) return null;
  const proxy = this.registry.getProxy(binding.currentInstancePort);
  const sessionId = binding.sessions.get(binding.currentInstancePort);
  return { proxy, sessionId };
}
```

## Telegram 命令扩展

### 新命令

| 命令 | 行为 |
|---|---|
| `/instance` | 列出所有在线实例：`[1] :4096 ✅` `[2] :4097 ✅` `[3] :4098 (idle)` |
| `/instance <N>` | 切换当前实例，恢复该实例的 session 绑定 |

### 更新 router.ts

`Command` 类型加：
```typescript
| { kind: "instance" }              // /instance 列表
| { kind: "instance-switch"; index: number }  // /instance <N>
```

### 更新 BOT_COMMANDS

加 `{ command: "instance", description: "切换 OpenCode 实例" }`。

## SSE 多实例订阅

### 问题

每个在线实例都要 subscribe SSE。实例下线时要 unsubscribe。

### 方案

InstanceRegistry 在实例上线时通知 Bridge，Bridge 为新实例创建 Proxy 并 subscribe。实例下线时停止 subscribe。

```typescript
// Bridge.start()
this.registry.start((instances) => {
  // 对比当前订阅的实例，新增的 subscribe，消失的 unsubscribe
  this.syncSubscriptions(instances);
});
```

`syncSubscriptions`：
1. 对比 `instances` 和当前 `subscriptions` Map
2. 新实例 → `proxy.subscribe(...)` → 存入 Map
3. 消失的实例 → 调用 stop 函数 → 从 Map 删除
4. 更新 `sessionToChat` 反向映射（基于当前实例的 session）

### 事件路由

事件回流时的反向映射：
- 当前：`sessionId → chatId`
- 改造：需要知道事件来自哪个实例 + 该实例的 session → chatId

```typescript
// subscribe 时给每个实例的 onEvent 闭包绑定 instancePort
proxy.subscribe(
  (sessionId) => this.getChatIdByInstance(instancePort, sessionId),
  (event) => this.handleProxyEvent(event),
);
```

`getChatIdByInstance`：遍历 chatBindings，找到 `currentInstancePort === port && sessions.has(sessionId)` 的 chatId。

## Out of Scope

- 实例的项目目录名显示（首期用端口标识，项目名后续从 /config 或 session title 推断）
- 每实例不同密码（首期假设无密码或全局统一）
- 独立窗口 / 设置界面（阶段 C/D/E）
- 跨机器实例发现（仅本机 localhost）
