# opencode-throughput

Real-time LLM performance monitoring for [OpenCode](https://opencode.ai) v2. Tracks latency, throughput, token usage, and cost per model, with a sidebar widget, toast notifications, and JSONL logging.

## Features

- **TTFT** (Time To First Token) — how fast the model starts generating
- **TPS** (Tokens Per Second) — generation throughput, measured over the generation phase so the TTFT wait is excluded
- **Total Latency** — end-to-end request time
- **Token Usage** — input, output, reasoning, cache read/write
- **Cost Tracking** — per-request and cumulative
- **Sidebar widget** — live per-model aggregates in the terminal sidebar
- **Toast Notifications** — a per-request metrics summary
- **JSONL Logging** — durable history at `~/.opencode/throughput.jsonl`
- **Benchmark tool** — ask the agent to summarise historical performance

## Requirements

OpenCode **v2.0.0 or newer**. The v1 plugin API was removed in v2, so this version does not run on OpenCode v1.

## Installation

### Local plugin (recommended, no build step)

Copy `src/` into a plugin directory. The plugin has no runtime dependencies — OpenCode provides `@opencode/plugin` and the OpenTUI packages.

Global, for every project under your home directory:

```sh
mkdir -p ~/.opencode/plugins/throughput
cp -r opencode-throughput/src/* ~/.opencode/plugins/throughput/
```

Per project:

```sh
mkdir -p .opencode/plugins/throughput
cp -r opencode-throughput/src/* .opencode/plugins/throughput/
```

Restart OpenCode (or run `opencode reload`) and confirm it is active:

```sh
opencode plugin list
```

### From npm

```sh
opencode plugin add opencode-throughput
```

## Usage

**Sidebar** — after the first request, the sidebar shows per-model averages and cost. Click the header to collapse it.

**Toasts** — each completed request raises a summary:

```
claude-sonnet-4-5 | 1.2s TTFT | 446 tok/s | 3.2s | ↑1.2k ↓892
```

**Benchmark tool** — ask the agent to use the `throughput_benchmark` tool:

> "Show me the benchmark stats for claude"
> "Compare model performance"
> "Show the last 10 requests"

**Logs** — every request is appended to `~/.opencode/throughput.jsonl`, one JSON object per line:

```json
{
  "ts": "2026-10-17T10:00:00.000Z",
  "model": "anthropic/claude-sonnet-4-5",
  "providerID": "anthropic",
  "modelID": "claude-sonnet-4-5",
  "sessionID": "ses_...",
  "messageID": "msg_...",
  "ttft_ms": 1200,
  "tps": 446,
  "latency_ms": 3200,
  "inputTokens": 1200,
  "outputTokens": 892,
  "reasoningTokens": 0,
  "cacheReadTokens": 500,
  "cacheWriteTokens": 200,
  "cost": 0.0234,
  "finish": "stop"
}
```

`ttft_ms` and `tps` are `null` when no token was streamed (for example a tool-call-only turn).

**Per-project log** — a rolling Markdown log is also written to `<project>/.opencode/throughput.md`.

## How it works

The plugin subscribes to the v2 server event stream:

| Event | Purpose |
| --- | --- |
| `session.step.started` | anchors the request start time and resolves the model |
| `session.text.started` / `session.reasoning.started` | anchors time-to-first-token (first of either kind) |
| `session.step.ended` | carries `cost`, `tokens`, and `finish`, and closes the measurement window |

One log entry is written per model request, which is the same granularity as one assistant message.

## Development

```sh
npm install
npm run typecheck
npm run verify        # typecheck, install, and all four verification scripts
```

Install your working copy into a plugin directory with:

```sh
npm run sync          # copies src/ to ~/.opencode/plugins/throughput
```

Then run `opencode reload`.

`npm run sync` installs a **real copy**, not a symlink. Module resolution follows
`realpath`, so a link back to this repo would make the repo's `node_modules`
reachable and the plugin would load a second `@opentui/core`, failing at import
with `Environment variable "OPENTUI_FORCE_UNICODE" is already registered with
different configuration`. The script refuses to install if it detects that
condition.

Verify the entrypoints against OpenCode's own V2 plugin validator and exercise the event handling:

```sh
npx tsx scripts/verify-plugin-shape.ts    # both entrypoints export { id, setup }
npx tsx scripts/verify-behavior.ts        # metric arithmetic, logging, tool, resubscribe
npx tsx scripts/verify-tui-setup.ts       # TUI setup, events, toasts, cleanup
npx tsx scripts/check-opentui-conflict.ts # a second @opentui/core copy is harmless
```

All four run in CI alongside the typecheck.

## License

MIT