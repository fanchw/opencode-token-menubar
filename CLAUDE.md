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

## Memory Management

Project memory lives in `.claude/memory/`.

- Read `.claude/memory/MEMORY.md` at session start if it exists.
- Write reusable project knowledge only, not session-specific task state.
- Prefer updating existing memory files over creating new ones.
- Do not duplicate rules already covered by `CLAUDE.md`.
- Update memory after important architecture decisions or completed milestones.
