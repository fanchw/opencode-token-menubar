# OpenCode Token Metrics Decisions

## 决策

采用 Electron menubar app + OpenCode global plugin + JSONL 原始事件 + SQLite 聚合查询。

## 原因

- Electron 适合快速实现 macOS 状态栏 app，并复用 React dashboard。
- OpenCode local/global plugin 目录会在启动时自动加载，global 插件路径应使用 `~/.config/opencode/plugins/`。
- plugin 保持轻量，只追加 JSONL，避免在 OpenCode 插件运行时引入 SQLite/native dependency。
- app 负责 JSONL 增量导入、SQLite 聚合、UI 展示，便于后续扩展趋势图和清理策略。

## 关键实现选择

- 插件使用 OpenCode 官方 `event` hook，返回 `{ event: async (...) => ... }`，不要使用 `$.on("event")`。
- OpenCode 官方可用事件包括 `message.updated` 和 `message.part.updated`，当前实现基于这些事件做 usage snapshot 差分。
- JSONL 行语义是正向 token usage delta，不是完整请求完成事件。
- JSONL importer 必须维护 byte offset，并在末尾 partial line 未完成时不推进 offset，避免写入过程中丢事件。
- 测试配置排除 `dist/**`，避免 build 后 Vitest 重复执行编译产物测试。

## 手动验证

完成代码验证后仍需真实 OpenCode 手动验证：

1. 运行 app。
2. 点击 Install Plugin。
3. 重启 OpenCode。
4. 触发一次模型请求。
5. 确认 `~/.config/opencode/token-metrics/events.jsonl` 有新增 JSONL 行。
6. 确认 dashboard 展示今日统计、最近请求、模型排行和趋势。
