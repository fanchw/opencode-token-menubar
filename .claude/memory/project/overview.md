# Project Overview

OpenCode Token Menubar 是一个 macOS Electron 状态栏应用，用来展示 OpenCode 大模型 token 使用量和 token 速度。

## 核心架构

| 模块 | 路径 | 职责 |
|------|------|------|
| OpenCode plugin | `plugin/token-metrics.ts` | 监听 OpenCode `message.updated` / `message.part.updated` / `message.part.delta` 事件，通过 step-start + text-delta 追踪 TTFT 和 Duration，计算正向 token usage delta，优先 POST 本地 ingest，失败时写 JSONL |
| Path resolver | `src/main/paths.ts` | 解析 JSONL、SQLite、global plugin、bundled plugin、ingest metadata 路径 |
| JSONL importer | `src/main/jsonlImporter.ts` | 按 byte offset 增量读取 JSONL，保留末尾 partial line，避免丢事件 |
| Ingest server | `src/main/ingestServer.ts` | Loopback HTTP 服务，统一 `{ code, message, data }` 响应 |
| Metrics store | `src/main/metricsStore.ts` | SQLite 存储：requests 表 + providers/models catalog 表，提供筛选查询 |
| Model catalog sync | `src/main/opencodeModels.ts` | 执行 `opencode models` 获取全量 provider/model 列表 |
| Electron main | `src/main/main.ts` | 管理 Tray、popup window、IPC、watcher、ingest、plugin install、catalog 同步、tray 标题 |
| Preload IPC | `src/main/preload.ts` | 暴露 `getDashboardData(filters)`、`installPlugin()`、`onDashboardUpdated()` |
| Dashboard | `src/renderer/App.tsx` | 三个 Filter Tab + summary cards + 趋势图 + 模型排行 + 最近请求 |
| Time filters | `src/renderer/timeFilters.ts` | 快捷范围解析、自定义范围校验、时区格式化 |

## 数据库表结构

### requests（请求记录）

```sql
id TEXT PK, timestamp, provider, model,
inputTokens, outputTokens, cacheTokens, tokens, duration, speed,
firstTokenLatencyMs
```

索引：`timestamp`、`(provider, model)`

### providers（Provider 注册表）

```sql
value TEXT PK, first_seen TEXT
```

### models（Model ↔ Provider 对应关系）

```sql
value TEXT, provider TEXT, first_seen TEXT
-- PK(value, provider)
```

数据来源：app 启动时 `opencode models` → `syncCatalog()`，每次 ingest 时 `upsertCatalog()`。不依赖运行时外部命令。

## 数据流

1. 用户点击安装插件 → bundled plugin 复制到 `~/.config/opencode/plugins/token-metrics.ts`
2. 重启 OpenCode 后 global plugin 生效
3. plugin 监听事件，对同一 message/session 做 usage snapshot 差分
4. 有正向 token delta 时，优先 POST 到 loopback ingest server
5. POST 失败时追加 JSONL fallback
6. Electron main 将事件导入 SQLite（ingest 时顺便 upsert catalog）
7. renderer 通过 IPC 获取 dashboard 数据，**事件驱动刷新**（`metrics:dashboard-updated`，main 广播，renderer debounce 120ms）

## Filter 系统

- **三个横向 Tab**：Range / Providers / Models
- **Range Tab**：react-day-picker 双月日历 + 快捷预设 + 自定义 datetime 输入 + Local/UTC 切换
- **Providers Tab**：搜索 + checkbox 列表，显示 token 数
- **Models Tab**：搜索 + checkbox 列表，显示 token 数 + provider 提示，选中 Provider 后联动过滤
- Tab 值显示选中摘要（过长省略 + hover tooltip）
- 弹出层为 fixed overlay，点击遮罩关闭，body overflow hidden 防滚动穿透

## Token 单位格式

`formatTokenUnit()` 使用大写十进制：K=1e3, M=1e6, B=1e9, T=1e12

## Tray 标题

- 有速度时：`OC 157/s`
- 无速度时：`OC 48K`（今日总量）
- 使用全局 today/recent 数据，不受 renderer filter 影响

## 验证命令

```bash
bun run test          # 73 个测试
bun run build         # Vite + tsc + esbuild
bun run dist          # 构建 + electron-builder 打包 universal dmg/zip
```

## 发版流程

1. 功能分支开发 → 合并到 main
2. 更新 `package.json` 的 `version`
3. `git tag v0.x.x && git push --tags`
4. `bun run dist` → 产出 `release/*.dmg` + `release/*.zip`（universal binary）
5. 上传 dmg 到 GitHub Releases

注意事项：
- `electron` 必须在 `devDependencies`（electron-builder 要求）
- 无代码签名（无 Developer ID），用户首次打开需右键"打开"绕过 Gatekeeper
- 图标在 `build/icon.icns`（从 SVG 通过 Chrome DevTools canvas 渲染 → iconutil 生成）
- `release/` 已在 `.gitignore`

## 视觉风格

蒸汽波+科幻 (Vaporwave + Sci-Fi)。详见 CLAUDE.md 的 Visual Style 章节。核心：深紫黑底、霓虹青/品红强调、无边框用 glow/毛玻璃区分区域、等宽字体。

## TODO

- （暂无）

## OpenCode 事件机制

源码位置：`~/project/js/opencode`（github.com/anomalyco/opencode）

### 事件分层

```
Provider SSE Stream
    ↓  [packages/llm]       SSE chunk → LLMEvent
LLMEvent Stream              (text-delta, step-finish[+usage], finish[+usage])
    ↓  [packages/core]      Session Runner 消费 → SessionEvent
SessionEvent                 (session.next.step.started/ended, session.next.text.delta)
    ↓  [packages/opencode]  桥接 → plugin event hook
Plugin.event({ type, properties })
```

### 关键发现

1. **内容流式 + Token 用量批量**：文本/推理 delta 每 SSE chunk 流一次，但 token usage 只在 step 结束时一次性发射
2. **V1 事件**（始终发射）：
   - `message.updated` — `{ properties.info.tokens }` 携带 token 数据
   - `message.part.updated` — `part.type` 可以是 `step-start`/`step-finish`/`text`/`tool` 等
   - `message.part.delta` — 流式文本增量，每 chunk 一次，**不携带 token 数据**
3. **V2 事件**（仅 `experimentalEventSystem` flag 开启时）：
   - `session.next.step.started` / `session.next.step.ended`（含 tokens）
   - `session.next.text.delta`
4. **TTFT 需自己计算**：OpenCode 开源版不追踪 TTFT（仅托管 Zen 服务有 `time_to_first_byte`）
5. **Token 数据来源**：`message.updated` 的 `properties.info.tokens` 结构为 `{ input, output, reasoning, cache: { read, write } }`
6. **step-start/step-finish** 标记每次 LLM 调用的开始和结束，一个 agentic loop 可能有多步

### 我们插件的 TTFT/Duration 追踪方案

- `message.part.updated` with `part.type === "step-start"` → 记录 `stepStartedAt`
- `message.part.delta` → 记录 `firstTokenAt`（首次到达 = 首字时间）
- `message.updated` with tokens → 发射 metric：
  - Duration = now - stepStartedAt（回退到 firstSeenAt）
  - TTFT = firstTokenAt - stepStartedAt（无 firstTokenAt 时为 null）

### 关键源码位置

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/session/event.ts` | 175-258 | V2 事件定义（Step/Text namespace） |
| `packages/core/src/session/runner/publish-llm-event.ts` | 17-27, 376-386 | LLMEvent→SessionEvent tokens() |
| `packages/llm/src/protocols/utils/lifecycle.ts` | 80-100 | `Lifecycle.finish()` usage 进入事件流的唯一入口 |
| `packages/llm/src/schema/events.ts` | 51-74 | `Usage` 类型定义 |
| `packages/opencode/src/plugin/index.ts` | 248-255 | 插件 event hook 派发 |
| `packages/opencode/src/session/processor.ts` | 684-728 | step-start/step-finish → V1 `updatePart` |
| `packages/opencode/src/session/processor.ts` | 759-839 | text-start/delta/end → V1 `updatePart`/`updatePartDelta` |
| `packages/opencode/src/session/session.ts` | 671-685, 906-914 | V1 事件发射点 |

## 教训

- **清理数据前必须征得用户确认**。即使数据部分字段不准确（如 duration=0、TTFT=null），其余字段（token 计数）仍然有效，用户可能希望保留。清数据是不可逆操作，务必先问。
- **修改插件代码后需手动同步到 `~/.config/opencode/shared/pluginMetric.ts`**。`pluginInstaller.ts` 只在用户点击"安装/重装"时才复制文件，开发期间改了源码不会自动同步到已安装位置。
- **OpenCode 事件的时间字段可能是 ISO 字符串而非数字**。`eventTime()` 必须同时处理 `number`（毫秒时间戳）和 `string`（ISO 日期）两种格式，否则所有时间解析 fallback 到 `Date.now()`，导致 duration=0、TTFT=null。
