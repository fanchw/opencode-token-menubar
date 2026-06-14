# CLAUDE.md

## Project Overview

OpenCode Token Menubar is a macOS Electron menubar app for viewing OpenCode LLM token usage and token speed. It installs a global OpenCode plugin, reads JSONL metric events, imports them into local SQLite, and renders dashboard summaries.

## Running the Application

Use Bun as the preferred package manager.

```bash
bun install
bun run build
bun run dev
```

Run the Electron shell in another terminal when the renderer dev server is active:

```bash
bun run dev:app
```

## Testing

Run focused tests for changed code first:

```bash
bun run test
```

Run build verification before claiming completion:

```bash
bun run build
```

## Architecture

| Path | Purpose |
|------|---------|
| `plugin/` | Bundled OpenCode plugin template |
| `src/main/` | Electron main process, tray, IPC, JSONL import, SQLite storage |
| `src/renderer/` | React dashboard UI |
| `src/shared/` | Shared metric and IPC types |
| `docs/superpowers/specs/` | Approved design specs |
| `docs/superpowers/plans/` | Implementation plans |

## Workflow Preferences

- Use Chinese for explanations and progress updates.
- Keep technical identifiers and code names in English.
- Follow conventional commits with Chinese messages, for example `feat: 初始化状态栏项目`.
- Do not add `Co-Authored-By` or generated signatures.
- Do not run broad tests when a focused test is enough.
- Restart OpenCode after changing global plugin files because plugins load at startup.

## Code Style

- Prefer small focused TypeScript modules with explicit exported types.
- Keep Electron main-process filesystem work out of renderer code.
- Expose renderer capabilities through preload IPC only.
- Store raw plugin events as JSONL and dashboard query data in SQLite.
- Avoid adding compatibility code unless there is a concrete persisted-data or external-consumer need.

## Format Conventions

- **Token 数量**：使用 `formatTokenUnit()`，大写十进制单位 `K` (1e3) / `M` (1e6) / `B` (1e9) / `T` (1e12)，保留两位小数，去掉末尾零（如 `3.25M`、`1.5K`、`48K`）。
- **速率**：TPM (tokens/min) 用 `formatTokenUnit()` 格式化，RPM (req/min) 用 `toFixed(2)`。
- **时间**：默认格式 `YYYY-MM-DD HH:MM:SS`（如 `2026-06-13 19:30:00`），通过 `formatTimeInZone(timestamp, timezone)` 不传 options 时生效；支持 Local / UTC 时区切换。
- **普通数字**：用 `Intl.NumberFormat("en-US")` 千分位格式化。

## Visual Style

整体风格为 **蒸汽波+科幻 (Vaporwave + Sci-Fi)**，核心原则：

- **配色**：深紫黑底 `#0a0410`，霓虹青 `#00f0ff` 主强调，品红 `#ff2e97` 次强调，紫 `#b026ff` 渐变用。
- **无边框**：panel/tab/chip/button/input 一律不用 `border`，用背景透明度差异 + `box-shadow` glow + 间距区分区域。
- **面板**：毛玻璃 `backdrop-filter: blur(6px)` + 顶部 cyan→pink 渐变线 `::before`。
- **发光**：关键数字加 `text-shadow`，hover/active 用 `box-shadow: 0 0 12px rgba(0,240,255,0.15)`。
- **标题**：h1 用 `linear-gradient(135deg, #00f0ff, #b026ff, #ff2e97)` 渐变文字 + `filter: drop-shadow()` 发光。
- **网格背景**：`rgba(0, 240, 255, 0.035)` 青色微光网格。
- **激活态**：filter-tab 用底部 2px 渐变线，chip/button 用 glow。
- **排名前三**：金/银/铜 `box-shadow` glow，不用 border。
- **图表配色不变**：Cache `#22c55e`、Fresh `#475569`、Output `#38bdf8`。
- **等宽字体**：所有数据/数值用 `"SFMono-Regular", Consolas, monospace`。

## TODO

- **国际化**：支持英文和简体中文。采用轻量内置方案（`t(key)` 字典函数，0 依赖），key 结构和字典 JSON 与 i18next 保持一致，便于后续无缝迁移到 `react-i18next`。

## Release / 发布流程

仓库：https://github.com/fanchw/opencode-token-menubar

### 分支策略

- **禁止直接修改 main 分支**
- 功能分支开发（`feat/xxx`、`fix/xxx`）→ PR → 合并 main
- CI 配置：`.github/workflows/release.yml` + `.github/release.yml`（release notes 分类）

### 发版触发方式

| 方式 | 操作 | 版本号 |
|------|------|--------|
| **PR 发版** | 创建 PR → 加 `release` label → 合并 | 自动递增 patch（v0.1.0 → v0.1.1） |
| **手动发版** | GitHub Actions 页面 → Release → Run workflow → 填版本号（可选） | 自定义或自动递增，必须 > 当前 |
| **不发版** | 普通 PR（无 `release` label） | 不触发 |

### CI 自动执行步骤

1. 从 git tag 获取最新版本号，计算下一个版本（patch +1 或自定义）
2. 校验新版本 > 当前版本
3. 更新 `package.json` version → commit → tag `v0.x.x` → push
4. `bun install` → `bun run build` → `bun run dist`（构建 arm64 + x64 dmg/zip）
5. 发布到 GitHub Releases（自动生成 release notes，按 label 分类）

### Release Notes 来源

- `generate_release_notes: true` + `.github/release.yml` 配置
- 按 PR label 自动分类：`feature`（新功能）、`bug`（修复）、`performance`（优化）、其他
- PR 标题建议用 conventional commits 格式

### 打包注意事项

- `electron` 必须在 `devDependencies`（electron-builder 要求）
- 前端依赖（react/recharts 等）放 `devDependencies`，Vite 已打包，避免打进 app.asar
- `vite.config.ts` 必须设 `base: "./"`（`loadFile` 需要 `file://` 相对路径）和 `emptyOutDir: true`（清理旧产物）
- 按架构分开打包（arm64 + x64），单个 dmg 约 115MB（universal 约 205MB）
- 无代码签名（无 Apple Developer ID），用户首次打开需右键"打开"绕过 Gatekeeper
- 应用图标 `assets/icon.icns`，tray 图标用 base64 内嵌 `src/main/main.ts`
- Actions 版本：`actions/checkout@v5`、`softprops/action-gh-release@v3`（Node.js 24 兼容）

## Memory Management

Project memory lives in `.claude/memory/`.

- Read `.claude/memory/MEMORY.md` at session start if it exists.
- Write reusable project knowledge only, not session-specific task state.
- Prefer updating existing memory files over creating new ones.
- Do not duplicate rules already covered by `CLAUDE.md`.
- Update memory after important architecture decisions or completed milestones.
