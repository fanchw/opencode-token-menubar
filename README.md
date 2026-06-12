# OpenCode Token Menubar

macOS menubar app for viewing OpenCode token usage and token speed.

## Features

- Installs a global OpenCode plugin that records token metrics.
- Writes OpenCode metric events to JSONL for durable ingestion.
- Imports metric events into local SQLite storage.
- Shows dashboard summaries for token usage, token speed, models, and hourly trends.

## Development

Install dependencies:

```bash
bun install
```

Run the renderer dev server:

```bash
bun run dev
```

Run the Electron shell in another terminal while the renderer dev server is active:

```bash
bun run dev:app
```

Build the app locally:

```bash
bun run build
```

## OpenCode Plugin

The app installs the bundled plugin globally to:

```text
~/.config/opencode/plugins/token-metrics.ts
```

Restart OpenCode after installing or reinstalling the plugin. OpenCode loads plugins at startup, so an already-running OpenCode session will not pick up plugin changes until it restarts.

## Data Paths

Plugin JSONL events are written to:

```text
~/.config/opencode/token-metrics/events.jsonl
```

Imported SQLite metrics are stored on macOS at:

```text
~/Library/Application Support/opencode-token-menubar/metrics.db
```

## Verification

Run tests:

```bash
bun run test
```

Run the local build:

```bash
bun run build
```

Check the OpenCode plugin can be bundled independently:

```bash
bun build plugin/token-metrics.ts --external @opencode-ai/plugin --outdir /tmp/opencode-token-plugin-check
```
