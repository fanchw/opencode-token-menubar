# OpenCode Token Menubar

macOS menubar app for viewing OpenCode token usage and token speed.

## Features

- Installs a global OpenCode plugin that records token metrics.
- Writes OpenCode metric events to JSONL for durable ingestion.
- Imports metric events into local SQLite storage.
- Shows dashboard summaries for token usage, token speed, models, and hourly trends.
- Optional Telegram bridge for remote monitoring and control of OpenCode sessions.

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

## Remote Bridge (Telegram)

The app can act as a remote proxy for OpenCode via a Telegram bot. Send prompts, view streamed responses, abort tasks, and approve permissions — all from Telegram on your phone.

### Setup

1. **Create a Telegram bot**: message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the bot token.

2. **Create the config file** at:

   ```text
   ~/Library/Application Support/opencode-token-menubar/bridge.json
   ```

   Minimal:

   ```json
   {
     "telegram": { "botToken": "123456:ABC-DEF..." }
   }
   ```

   Full options:

   ```jsonc
   {
     "telegram": { "botToken": "..." },
     "opencode": {
       "baseUrl": "http://localhost:4096",  // optional; omit = auto-detect
       "password": "..."                     // optional; for password-protected servers
     },
     "allowlist": [123456789],               // optional; Telegram user IDs, omit = allow all
     "autoApprove": false,                   // optional; true = auto-approve all permissions
     "throttleMs": 1500                      // optional; stream update interval
   }
   ```

   Custom config path via environment variable:

   ```bash
   BRIDGE_CONFIG_PATH=/path/to/bridge.json bun run dev:app
   ```

3. **Start OpenCode** (the app auto-detects the running instance). If auto-detection fails, set `opencode.baseUrl` explicitly.

4. **Restart the app** — check the console for `Bridge started`.

### Commands

| Send | Action |
|------|--------|
| `/new` | Create a new OpenCode session |
| Plain text | Send as prompt to the current session |
| `/abort` | Abort the running task |
| `/status` | Show current session and model |
| `/list` | List all sessions |
| `/switch <id>` | Switch to a session |
| `/help` | Show command list |

### Permissions

When OpenCode requests permission for a dangerous operation, the bot sends a message with inline buttons:

```
🔐 bash: rm -rf node_modules
  [✅ Allow once]  [🔁 Always]  [❌ Reject]
```

Tap a button to respond. Set `"autoApprove": true` in the config to skip prompts.

### Notes

- OpenCode must be running and reachable (`localhost:4096` by default, or auto-detected via v2 daemon `server.json`).
- Consecutive messages queue automatically (max 4 pending).
- The bridge is purely additive — no config, no startup; existing token metrics are unaffected.

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
