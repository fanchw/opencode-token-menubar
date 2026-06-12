# Project Overview

OpenCode Token Menubar 是一个 macOS Electron 状态栏应用，用来展示 OpenCode 大模型 token 使用量和 token 速度。

## 核心架构

| 模块 | 路径 | 职责 |
|------|------|------|
| OpenCode plugin | `plugin/token-metrics.ts` | 监听 OpenCode `message.updated` / `message.part.updated` 事件，计算正向 token usage delta，优先 POST 本地 ingest，失败时写 JSONL |
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
5. 有正向 token delta 时，plugin 优先 POST 到 Electron main 的 loopback ingest server。
6. POST 失败时，plugin 追加 JSONL fallback 到 `~/.config/opencode/token-metrics/events.jsonl`。
7. Electron main 将 ingest 事件或 JSONL fallback 导入 SQLite：`~/Library/Application Support/opencode-token-menubar/metrics.db`。
8. renderer 当前通过 IPC 获取 dashboard 数据，每 2 秒刷新。

## 待改体验问题

- macOS 菜单栏状态仍然不稳定展示，需要检查 Tray 生命周期、图标/标题策略、context menu 与窗口定位。
- Dashboard 刷新目前依赖 renderer 2 秒轮询，应改为 Electron main 在 ingest/JSONL 导入后主动推送更新事件。
- 页面视觉偏厚重 AI 风，需要轻盈科技风，减少大面积深色渐变和重阴影，提升信息密度与层次。
- 交互缺少 provider、model、时间等筛选维度，需要支持按来源和时间范围区分查看。

## 验证命令

```bash
bun run test
bun run build
bun build plugin/token-metrics.ts --external @opencode-ai/plugin --outdir /tmp/opencode-token-plugin-check
```

`bun run build` 当前会出现 Vite chunk 大于 500 kB 的 warning，主要来自 Recharts，不影响构建通过。
