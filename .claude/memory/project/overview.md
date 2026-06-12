# Project Overview

OpenCode Token Menubar 是一个 macOS Electron 状态栏应用，用来展示 OpenCode 大模型 token 使用量和 token 速度。

## 核心架构

| 模块 | 路径 | 职责 |
|------|------|------|
| OpenCode plugin | `plugin/token-metrics.ts` | 监听 OpenCode `message.updated` / `message.part.updated` 事件，计算正向 token usage delta，并追加 JSONL |
| Path resolver | `src/main/paths.ts` | 解析 JSONL、SQLite、global plugin、bundled plugin 路径 |
| JSONL importer | `src/main/jsonlImporter.ts` | 按 byte offset 增量读取 JSONL，保留末尾 partial line，避免丢事件 |
| Metrics store | `src/main/metricsStore.ts` | 使用 SQLite 存储指标并提供今日汇总、最近请求、模型排行、小时趋势 |
| Electron main | `src/main/main.ts` | 管理 Tray、popup window、IPC、watcher、import state、plugin install |
| Preload IPC | `src/main/preload.ts` | 暴露 `window.tokenMetrics.getDashboardData()` 和 `installPlugin()` |
| Dashboard | `src/renderer/App.tsx` | 展示 summary cards、趋势图、模型排行、最近请求、设置 |

## 数据流

1. 用户在 app 中点击安装插件。
2. app 将 bundled plugin 安装到 `~/.config/opencode/plugins/token-metrics.ts`。
3. 用户重启 OpenCode，让 global plugin 生效。
4. plugin 监听 `message.updated` / `message.part.updated`，对同一 message/session 做 usage snapshot 差分。
5. 有正向 token delta 时，plugin 追加一行 JSON 到 `~/.config/opencode/token-metrics/events.jsonl`。
6. Electron main 监听 JSONL 文件变化，从持久化 offset 增量读取新行。
7. importer 标准化事件后写入 SQLite：`~/Library/Application Support/opencode-token-menubar/metrics.db`。
8. renderer 通过 IPC 获取 dashboard 数据，每 2 秒刷新。

## 验证命令

```bash
bun run test
bun run build
bun build plugin/token-metrics.ts --external @opencode-ai/plugin --outdir /tmp/opencode-token-plugin-check
```

`bun run build` 当前会出现 Vite chunk 大于 500 kB 的 warning，主要来自 Recharts，不影响构建通过。
