# OpenCode Token Menubar Design

## Goal

Build a macOS menubar app for viewing OpenCode LLM token usage and token speed in near real time.

The first version provides:

- A status bar indicator for recent token speed or today's total tokens.
- A popup dashboard with today's totals, recent requests, model ranking, and hourly trends.
- A built-in installer for a global OpenCode plugin.
- Local persistence optimized for dashboard queries.

## Chosen Approach

Use an Electron menubar app under `js/opencode-token-menubar/`.

The app ships with an OpenCode plugin template. The app installs that plugin globally to `~/.config/opencode/plugin/`, then prompts the user to restart OpenCode because OpenCode loads plugins only at startup.

The plugin writes raw metric events as JSONL. The menubar app watches the JSONL file and imports events into a local SQLite database for aggregation and dashboard queries.

This keeps the plugin small and stable while allowing the app to maintain richer indexes, history, trends, and cleanup policies.

## Data Flow

1. OpenCode starts and loads the global plugin from `~/.config/opencode/plugin/`.
2. The plugin listens to LLM lifecycle events and derives request metrics.
3. The plugin appends one JSON object per completed request to `~/.config/opencode/token-metrics/events.jsonl`.
4. The menubar app watches the JSONL file for changes.
5. The app imports new lines into SQLite at `~/Library/Application Support/opencode-token-menubar/metrics.db`.
6. The popup dashboard queries SQLite for summary cards, recent requests, rankings, and trends.

## Metric Event Shape

Each JSONL event represents one completed LLM request.

```json
{
  "id": "stable-request-id",
  "timestamp": "2026-06-11T08:30:00.000Z",
  "provider": "openai",
  "model": "gpt-4.1",
  "inputTokens": 1200,
  "outputTokens": 800,
  "totalTokens": 2000,
  "durationMs": 4200,
  "tokensPerSecond": 190.48
}
```

The plugin should tolerate missing provider, model, or token fields. Missing provider/model values are recorded as `unknown`. Missing token counts default to `0` so the event is still visible in recent requests.

## Storage

### JSONL

The JSONL file is the raw append-only source of truth produced by the plugin.

Path:

```text
~/.config/opencode/token-metrics/events.jsonl
```

### SQLite

SQLite is owned by the menubar app and used for fast aggregation.

Path:

```text
~/Library/Application Support/opencode-token-menubar/metrics.db
```

Initial table:

```sql
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  tokens_per_second REAL NOT NULL
);

CREATE INDEX idx_requests_timestamp ON requests(timestamp);
CREATE INDEX idx_requests_provider_model ON requests(provider, model);
```

Imports are idempotent by `id`. Invalid JSONL lines are skipped and counted for diagnostics.

## App Structure

Recommended project path:

```text
js/opencode-token-menubar/
```

Core files:

- `package.json` for Electron scripts and build config.
- `src/main/` for Electron main process, tray, window lifecycle, file watcher, SQLite import, and plugin installer.
- `src/renderer/` for dashboard UI.
- `src/shared/` for event and query types.
- `plugin/token-metrics.ts` for the bundled OpenCode plugin template.
- `README.md` for install, dev, and OpenCode restart instructions.

## Menubar UX

The app runs as a macOS status bar app.

Status bar label priority:

1. Show recent request speed when a recent request exists, for example `42 tok/s`.
2. Otherwise show today's total tokens, for example `12.4K tok`.
3. If no data exists, show `OpenCode` or a compact icon-only state.

Clicking the status item opens a popup dashboard.

## Dashboard

The first version contains four sections.

### Today Summary

Cards:

- Total tokens.
- Input tokens.
- Output tokens.
- Average tokens per second.

### Recent Requests

Table rows show:

- Time.
- Provider.
- Model.
- Input/output/total tokens.
- Duration.
- Tokens per second.

### Model Ranking

Grouped by `provider/model`:

- Request count.
- Total tokens.
- Input tokens.
- Output tokens.
- Average tokens per second.

### Hourly Trends

The initial trend chart shows today's hourly total tokens and average tokens per second.

## Settings

The settings area includes:

- Plugin install or reinstall action.
- Current plugin install path.
- Current JSONL path.
- Current SQLite path.
- Last import status.
- A clear notice that OpenCode must be restarted after plugin installation.

The first version installs globally by default:

```text
~/.config/opencode/plugin/token-metrics.ts
```

Project-level installation is out of scope for the first version.

## Error Handling

- If the plugin is not installed, show an empty state with an install action.
- If the JSONL file does not exist, show an empty state and keep watching the parent directory.
- If SQLite initialization fails, show an error state with the database path.
- If an event line is invalid JSON, skip it and increment an import error counter.
- If an event is missing optional metric fields, import with defaults instead of dropping the row.

## Testing Scope

Use focused tests and checks only.

- Unit-test event parsing and normalization.
- Unit-test aggregation queries for today summary, model ranking, and hourly trends.
- Unit-test plugin installer path handling using a temporary directory.
- Run the app build or type check for the menubar project.

Manual verification:

- Start the app in development mode.
- Install the plugin globally from the app.
- Restart OpenCode.
- Trigger one or more model calls.
- Confirm JSONL receives events and the dashboard updates.

## Out of Scope

- Cost estimation and pricing tables.
- Syncing metrics across machines.
- Uploading telemetry to any remote service.
- Project-level plugin installation UI.
- Full native Swift implementation.
- Directly writing SQLite from the OpenCode plugin.
