/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"
import type { LogEntry } from "./types.js"
import { buildSummaryLine, formatMs, formatNum, formatTokenCount, getModelKey, truncate } from "./format.js"
import { emptyStats, totalCost, totalCount, updateStats } from "./stats.js"

const MAX_RECENT = 10
const MAX_MODELS = 50
const MODEL_MAX = 28

function modelStatsLine(model: string, s: ReturnType<typeof emptyStats>): string {
  return (
    `${truncate(model.split("/").pop() ?? model, MODEL_MAX)} ` +
    `${formatMs(s.avgTTFT)} ${formatNum(s.avgTPS)}/s ${formatMs(s.avgLatency)} ` +
    `↑${formatTokenCount(s.totalInputTokens)} ↓${formatTokenCount(s.totalOutputTokens)} ` +
    `$${s.totalCost.toFixed(4)}`
  )
}

function entryLine(e: LogEntry): string {
  return (
    `${truncate(e.modelID, MODEL_MAX)} ` +
    `${formatMs(e.ttft_ms)} ${formatNum(e.tps)}/s ${formatMs(e.latency_ms)} ` +
    `↑${formatTokenCount(e.inputTokens)} ↓${formatTokenCount(e.outputTokens)}`
  )
}

function ThroughputWidget(props: {
  context: Context
  stats: () => readonly ReturnType<typeof emptyStats>[]
  recent: () => readonly LogEntry[]
}) {
  const [open, setOpen] = createSignal(true)
  const theme = (): ResolvedTheme => props.context.theme
  const count = createMemo(() => totalCount(props.stats()))
  const cost = createMemo(() => totalCost(props.stats()))

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} onMouseDown={() => count() > 0 && setOpen((v) => !v)}>
        <Show when={count() > 0}>
          <text fg={theme().text.base}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme().text.base}>
          <b>Throughput</b>
          <Show when={count() > 0}>
            {"  "}
            {count()} reqs{"  "}
            {"$"}
            {cost().toFixed(4)}
          </Show>
        </text>
      </box>

      <Show when={count() === 0}>
        <text fg={theme().text.muted}> Waiting for requests...</text>
      </Show>

      <Show when={open() && count() > 0}>
        <For each={props.stats()}>{(s) => <text fg={theme().text.muted}>  {modelStatsLine(s.model, s)}</text>}</For>

        <Show when={props.recent().length > 0}>
          <text fg={theme().text.base}>
            {"  "}
            <b>Recent</b>
          </text>
          <For each={props.recent()}>{(e) => <text fg={theme().text.muted}>  {entryLine(e)}</text>}</For>
        </Show>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-throughput",

  setup(context) {
    const [entries, setEntries] = createSignal<LogEntry[]>([])
    const [statsMap, setStatsMap] = createSignal(new Map<string, ReturnType<typeof emptyStats>>())
    const stats = createMemo(() => [...statsMap().values()])

    // First-token anchors, mirroring the server plugin so the sidebar can show
    // TTFT without waiting for the request to complete.
    const steps = new Map<string, { sessionID: string; providerID: string; modelID: string; startedAt: number }>()
    const firstTokenAt = new Map<string, number>()

    const clearSession = (sessionID: string) => {
      for (const [messageID, meta] of steps) {
        if (meta.sessionID !== sessionID) continue
        steps.delete(messageID)
        firstTokenAt.delete(messageID)
      }
    }

    const unsubscribes = [
      context.data.on("session.step.started", (event) => {
        steps.set(event.data.assistantMessageID, {
          sessionID: event.data.sessionID,
          providerID: event.data.model.providerID,
          modelID: event.data.model.id,
          startedAt: event.data.started ?? event.created,
        })
      }),

      context.data.on("session.text.started", (event) => {
        const id = event.data.assistantMessageID
        if (!firstTokenAt.has(id)) firstTokenAt.set(id, event.created)
      }),

      context.data.on("session.reasoning.started", (event) => {
        const id = event.data.assistantMessageID
        if (!firstTokenAt.has(id)) firstTokenAt.set(id, event.created)
      }),

      context.data.on("session.step.ended", (event) => {
        const { sessionID, assistantMessageID, finish, cost, tokens } = event.data
        const meta = steps.get(assistantMessageID)
        const startedAt = meta?.startedAt ?? event.created
        const firstToken = firstTokenAt.get(assistantMessageID)

        const latencyMs = event.created - startedAt
        const generationMs = firstToken != null ? event.created - firstToken : latencyMs
        const outputTokens = tokens?.output ?? 0

        const providerID = meta?.providerID ?? ""
        const modelID = meta?.modelID ?? "unknown"
        const modelKey = getModelKey(providerID, modelID)

        const entry: LogEntry = {
          ts: new Date().toISOString(),
          model: modelKey,
          providerID,
          modelID,
          sessionID,
          messageID: assistantMessageID,
          ttft_ms: firstToken != null ? firstToken - startedAt : null,
          tps: generationMs > 0 && outputTokens > 0 ? (outputTokens / generationMs) * 1000 : null,
          latency_ms: latencyMs > 0 ? latencyMs : null,
          inputTokens: tokens?.input ?? 0,
          outputTokens,
          reasoningTokens: tokens?.reasoning ?? 0,
          cacheReadTokens: tokens?.cache?.read ?? 0,
          cacheWriteTokens: tokens?.cache?.write ?? 0,
          cost: cost ?? 0,
          finish,
        }

        setStatsMap((prev) => {
          const next = new Map(prev)
          if (!next.has(modelKey)) {
            // Bound the map so a long session cycling through many model
            // variants cannot grow it without limit. Oldest insertion is first.
            if (next.size >= MAX_MODELS) {
              const oldest = next.keys().next().value
              if (oldest !== undefined) next.delete(oldest)
            }
            next.set(modelKey, emptyStats(modelKey))
          }
          updateStats(next, modelKey, entry)
          return next
        })

        setEntries((prev) => {
          const next = [...prev, entry]
          return next.length > MAX_RECENT ? next.slice(-MAX_RECENT) : next
        })

        // Toasts belong to the terminal client, so they are raised here rather
        // than from the server plugin.
        context.ui.toast.show({
          title: "Throughput",
          message: buildSummaryLine(entry),
          variant: finish === "error" ? "error" : "info",
          duration: 4000,
          sessionID,
        })

        steps.delete(assistantMessageID)
        firstTokenAt.delete(assistantMessageID)
      }),

      context.data.on("session.execution.failed", (event) => clearSession(event.data.sessionID)),
      context.data.on("session.execution.interrupted", (event) => clearSession(event.data.sessionID)),
      context.data.on("session.deleted", (event) => clearSession(event.data.sessionID)),
    ]

    const unclaim = context.ui.slot({
      append: "sidebar.content",
      render: () => <ThroughputWidget context={context} stats={stats} recent={entries} />,
    })

    return () => {
      unclaim()
      for (const off of unsubscribes) off()
      steps.clear()
      firstTokenAt.clear()
    }
  },
})