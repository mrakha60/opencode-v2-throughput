/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin"
import type { OpenCodeEvent } from "@opencode/client"
import type { LogEntry } from "./types.js"
import { getModelKey, buildSummaryLine } from "./format.js"
import { appendLog, readLogs, writeThroughputMarkdown } from "./log.js"
import { renderBenchmarkReport } from "./benchmark.js"

type StepMeta = {
  sessionID: string
  providerID: string
  modelID: string
  startedAt: number
}

const BENCHMARK_INPUT = {
  type: "object",
  properties: {
    model: {
      type: "string",
      description:
        "Filter by model name (partial match, e.g. 'claude' or 'gpt'). Omit for all models.",
    },
    last: {
      type: "number",
      description: "Only show the last N entries.",
    },
  },
  additionalProperties: false,
} as const

export default Plugin.define({
  id: "opencode-throughput",

  async setup(ctx) {
    const controller = new AbortController()
    const locationDirectory = ctx.location.directory

    /**
     * The event stream is server-wide, so a plugin instance only records the
     * events belonging to its own location. Events without a location are
     * accepted, which keeps recording working on a bare local server.
     */
    const isMine = (event: OpenCodeEvent): boolean => {
      const location = (event as { location?: { directory?: string } }).location
      if (!location?.directory) return true
      return location.directory === locationDirectory
    }

    const steps = new Map<string, StepMeta>()
    const firstTokenAt = new Map<string, number>()

    const clearSession = (sessionID: string) => {
      for (const [messageID, meta] of steps) {
        if (meta.sessionID !== sessionID) continue
        steps.delete(messageID)
        firstTokenAt.delete(messageID)
      }
    }

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (!isMine(event)) continue

          switch (event.type) {
            case "session.step.started": {
              const { sessionID, assistantMessageID, model } = event.data
              steps.set(assistantMessageID, {
                sessionID,
                providerID: model.providerID,
                modelID: model.id,
                startedAt: event.data.started ?? event.created,
              })
              break
            }

            // The first token of any kind anchors TTFT. Reasoning counts, so a
            // reasoning-only response still reports a time to first token.
            case "session.text.started":
            case "session.reasoning.started": {
              const messageID = event.data.assistantMessageID
              if (!firstTokenAt.has(messageID)) firstTokenAt.set(messageID, event.created)
              break
            }

            case "session.step.ended": {
              const { sessionID, assistantMessageID, finish, cost, tokens } = event.data
              const meta = steps.get(assistantMessageID)
              const startedAt = meta?.startedAt ?? event.created
              const firstToken = firstTokenAt.get(assistantMessageID)

              const latencyMs = event.created - startedAt
              const ttftMs = firstToken != null ? firstToken - startedAt : null

              // TPS measures the generation phase, so the time spent waiting for
              // the first token is excluded rather than folded into the rate.
              const generationMs =
                firstToken != null ? event.created - firstToken : latencyMs
              const outputTokens = tokens?.output ?? 0
              const tps =
                generationMs > 0 && outputTokens > 0 ? (outputTokens / generationMs) * 1000 : null

              const providerID = meta?.providerID ?? ""
              const modelID = meta?.modelID ?? "unknown"

              const entry: LogEntry = {
                ts: new Date().toISOString(),
                model: getModelKey(providerID, modelID),
                providerID,
                modelID,
                sessionID,
                messageID: assistantMessageID,
                ttft_ms: ttftMs,
                tps,
                latency_ms: latencyMs > 0 ? latencyMs : null,
                inputTokens: tokens?.input ?? 0,
                outputTokens,
                reasoningTokens: tokens?.reasoning ?? 0,
                cacheReadTokens: tokens?.cache?.read ?? 0,
                cacheWriteTokens: tokens?.cache?.write ?? 0,
                cost: cost ?? 0,
                finish,
              }

              appendLog(entry)
              writeThroughputMarkdown(locationDirectory, entry)
              console.log(`[throughput] ${buildSummaryLine(entry)}`)

              steps.delete(assistantMessageID)
              firstTokenAt.delete(assistantMessageID)
              break
            }

            case "session.execution.failed":
            case "session.execution.interrupted":
            case "session.deleted": {
              clearSession(event.data.sessionID)
              break
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[throughput] event subscription failed:", error)
        }
      }
    })()

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "throughput",
        description: "Model performance benchmarks recorded by opencode-throughput.",
      })
      editor.add({
        name: "benchmark",
        description:
          "Query recorded model performance: latency (TTFT and total), throughput (TPS), token usage, and cost, aggregated by model.",
        input: BENCHMARK_INPUT,
        options: { namespace: "throughput" },
        async execute(input) {
          const args = (input ?? {}) as { model?: string; last?: number }
          return { content: renderBenchmarkReport(readLogs(), args) }
        },
      })
    })

    return () => controller.abort()
  },
})