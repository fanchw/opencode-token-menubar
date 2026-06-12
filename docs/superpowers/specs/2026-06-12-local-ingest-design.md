# Local Ingest Design

## Goal

Replace JSONL as the primary OpenCode plugin transport with a local ingest service owned by the Electron main process.

The plugin should send token metric events directly to the running menubar app. The app validates events, writes them to SQLite, and updates the tray/dashboard from the same storage path it already owns.

## Chosen Approach

Use a loopback HTTP endpoint bound to `127.0.0.1` from the Electron main process.

The OpenCode plugin posts each normalized `MetricEvent` to this local endpoint. If the app is not running or the request fails, the plugin falls back to appending the same event to JSONL. The app continues to import fallback JSONL events on startup and file changes, then truncates or rotates the JSONL file after a successful import.

This keeps SQLite writes centralized in the app, avoids SQLite dependencies inside the OpenCode plugin, and prevents the JSONL file from growing indefinitely during normal operation.

## Data Flow

1. The Electron main process starts a local HTTP ingest server during app startup.
2. The app writes connection metadata to `~/.config/opencode/token-metrics/ingest.json`.
3. OpenCode loads the global plugin from `~/.config/opencode/plugins/token-metrics.ts`.
4. The plugin derives positive token usage deltas from OpenCode message events.
5. The plugin reads `ingest.json` and posts the event to the local ingest endpoint.
6. The app validates and inserts the event into SQLite using `MetricsStore.insertEvents()`.
7. If posting fails, the plugin appends the event to `events.jsonl` as a fallback queue.
8. The app imports fallback JSONL events and truncates or rotates that file after successful import.

## Ingest Metadata

The app writes a small metadata file so the plugin does not need a hard-coded port.

Path:

```text
~/.config/opencode/token-metrics/ingest.json
```

Shape:

```json
{
  "url": "http://127.0.0.1:49231/metrics",
  "token": "random-per-app-session-token",
  "updatedAt": "2026-06-12T00:00:00.000Z"
}
```

The `token` is not a security boundary against local users. It prevents accidental writes from unrelated local processes and lets the app reject stale or malformed requests.

## HTTP Contract

Endpoint:

```text
POST /metrics
```

Headers:

```text
Content-Type: application/json
Authorization: Bearer <token>
```

Body is one normalized `MetricEvent`.

Success response:

```json
{
  "code": 0,
  "message": "ok",
  "data": { "accepted": true }
}
```

Failure responses use the same `code/message/data` envelope with non-zero `code` values. HTTP status still reflects the broad failure class:

```json
{
  "code": 422,
  "message": "invalid metric payload",
  "data": null
}
```

Failure status codes:

- `400` for request body read failures.
- `401` for missing or invalid token.
- `405` for non-POST requests.
- `413` for oversized bodies.
- `422` for invalid metric payloads.
- `500` for SQLite insertion failures.

## JSONL Fallback

JSONL remains a reliability fallback, not the primary transport.

Fallback path:

```text
~/.config/opencode/token-metrics/events.jsonl
```

The app keeps the existing offset-based importer, but after inserting all complete fallback lines it should compact storage by truncating or rotating the file. If truncation is used, the import offset resets to `0` after the imported content is removed.

The fallback file may temporarily grow while the app is not running, but it should not grow indefinitely during normal operation.

## Error Handling

- If `ingest.json` is missing, the plugin writes JSONL fallback.
- If `ingest.json` is stale or points to a closed port, the plugin writes JSONL fallback.
- If the ingest server receives invalid JSON, it rejects the request and does not write SQLite.
- If SQLite insertion fails, the HTTP request fails so the plugin can preserve the event in JSONL.
- If JSONL import encounters invalid lines, it preserves existing diagnostic counting behavior.
- On app quit, the server closes and the app removes or invalidates `ingest.json`.

## Testing Scope

- Unit-test ingest metadata path resolution and parsing.
- Unit-test HTTP ingest acceptance, auth rejection, malformed payload rejection, and SQLite insertion.
- Unit-test fallback JSONL compaction after successful import.
- Unit-test plugin delivery behavior for success and failed local posts if the plugin logic can be isolated.
- Run the focused test suite and build for this project before claiming completion.

## Out of Scope

- Remote telemetry or cross-machine sync.
- Direct SQLite writes from the OpenCode plugin.
- Replacing Electron IPC used by the renderer dashboard.
- Strong local-user isolation beyond loopback binding and a random session token.
