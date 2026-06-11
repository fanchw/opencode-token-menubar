# OpenCode Token Menubar

macOS menubar app for viewing OpenCode token usage and token speed.

## Development

```bash
bun install
bun run build
bun run dev
```

In another terminal:

```bash
bun run dev:app
```

## OpenCode Plugin

The app installs the bundled plugin globally to:

```text
~/.config/opencode/plugin/token-metrics.ts
```

Restart OpenCode after installing or reinstalling the plugin.
