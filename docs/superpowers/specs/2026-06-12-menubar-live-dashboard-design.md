# Menubar Live Dashboard Experience Design

## Goal

Improve the app from a polling dashboard into a reliable macOS menubar utility with live updates, useful filtering, and a lighter developer-tool visual style.

## Problems

- The macOS menu bar item is still unreliable or hard to notice.
- The renderer refreshes every 2 seconds instead of updating when new metrics arrive.
- The current UI feels heavy and generic, with limited filtering and weak data exploration.

## Product Direction

Use the `Midnight Terminal` direction: a restrained dark interface, thin separators, compact cards, monospace tabular data, minimal glow, and high information density. The app should feel like a lightweight developer tool rather than an AI-themed dashboard.

## Menubar Behavior

- Keep a visible text fallback title so the app remains discoverable even if the icon fails.
- Use a stable macOS template icon for the tray item.
- Show compact status in the title:
  - Recent active speed: `OC 157/s`
  - Otherwise today's total: `OC 48K`
  - No data: `OC`
- Tray title uses global today/recent activity and does not follow renderer filters.
- Left click toggles the popover.
- Add a context menu with `Refresh`, `Install/Reinstall Plugin`, and `Quit`.
- Position the popover near the tray item while clamping to the current display work area.

## Live Update Architecture

- Remove renderer interval polling for normal updates.
- Keep an initial dashboard fetch when the renderer mounts and when the popover opens.
- Electron main broadcasts a `metrics:dashboard-updated` event after data changes:
  - local ingest inserts a metric
  - JSONL fallback importer inserts metrics
  - plugin install changes plugin state
- Renderer subscribes through preload IPC, then calls `getDashboardData(currentFilters)` to fetch the latest filtered result.
- Use a lightweight debounce in the renderer to collapse bursts of events into one fetch.

## Dashboard Query Model

Extend dashboard queries from fixed today-only data to filter-based data.

### Filters

- `start`: ISO timestamp, required after the renderer resolves a range.
- `end`: ISO timestamp, required after the renderer resolves a range.
- `providers`: string array, optional multi-select.
- `models`: string array, optional multi-select.

### Returned Data

- Summary metrics for the filtered range.
- Recent requests for the filtered range.
- Model ranking for the filtered range.
- Hourly or bucketed trends for the filtered range.
- Available provider/model options with counts and token totals.
- Existing operational metadata: plugin status, paths, import errors.

## Time Filters

The top filter bar includes both quick presets and custom range selection.

### Quick Presets

- `Today`
- `This Week`
- `This Month`
- `15m`
- `1h`
- `6h`
- `24h`
- `7d`
- `30d`

Relative presets are resolved in the renderer before querying IPC. Calendar presets use local time boundaries.

### Custom Range

- Provide start and end date/time inputs.
- Validate that start is before end.
- Disable querying or show an inline error for invalid ranges.
- Preserve the current range while provider/model filters change.

## Timezone Display

- Add a display timezone setting for the dashboard.
- Default to the system local timezone.
- Support at least `Local` and `UTC` in the first iteration.
- Apply the selected timezone to visible timestamps, calendar preset boundaries, and chart bucket labels.
- Keep stored metric timestamps as ISO UTC values in SQLite.
- Show the active timezone near the time filter so range interpretation is explicit.

## Provider And Model Filters

- Use searchable multi-select controls for provider and model.
- Show options with lightweight usage context, such as request count or token total.
- Support clear-all and active filter chips.
- Model options should narrow naturally when provider filters are active.
- If a selected provider/model disappears from the current range, keep the chip visible but mark it as having no matching data until cleared.

## Visual Structure

- Header: product label, live ingest status, plugin status, compact total.
- Filter bar: time presets, custom range button/inputs, timezone selector, provider multi-select, model multi-select.
- Summary strip: requests, total tokens, input, output, average speed.
- Trend panel: compact token trend for selected range.
- Analysis table: recent requests with time, provider, model, tokens, speed.
- Ranking panel: top provider/model pairs with token and request totals.
- Settings/details area: local paths and install/reinstall plugin action, visually secondary.

## Error Handling

- If live IPC subscription fails, keep initial fetch behavior and expose a visible error.
- If a query fails, keep the last successful data visible and show an inline error.
- If plugin is not installed, show a compact setup notice rather than taking over the page.
- If no data matches filters, show an empty state that identifies the active filters.

## Testing

- Unit test range resolution for quick presets and custom validation.
- Unit test timezone-aware range boundaries and timestamp labels.
- Unit test filtered SQLite queries for provider, model, and time constraints.
- Unit test preload event subscription cleanup.
- Add renderer-level tests only if existing test patterns support them; otherwise keep logic in testable pure helpers.
- Run focused tests for changed modules, then `bun run build` before completion.

## Non-Goals

- No historical migration of existing `unknown` provider/model rows.
- No remote sync or cloud storage.
- No full analytics workspace outside the menubar popover scope.
- No packaging/signing changes in this iteration.
