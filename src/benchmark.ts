import type { LogEntry } from "./types.js"
import { formatMs, formatNum } from "./format.js"

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function present(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v))
}

export function renderBenchmarkReport(
  all: LogEntry[],
  options: { model?: string; last?: number } = {},
): string {
  if (all.length === 0) {
    return "No benchmark data yet. The throughput plugin needs to process at least one LLM response before stats are available."
  }

  const keyword = options.model?.toLowerCase()
  const filtered = keyword
    ? all.filter(
        (e) =>
          e.model.toLowerCase().includes(keyword) || e.modelID.toLowerCase().includes(keyword),
      )
    : all

  const sliced = options.last != null && options.last > 0 ? filtered.slice(-options.last) : filtered

  if (sliced.length === 0) {
    return `No benchmark entries matched ${JSON.stringify(options.model)}. Known models: ${[...new Set(all.map((e) => e.model))].join(", ")}`
  }

  const byModel = new Map<string, LogEntry[]>()
  for (const entry of sliced) {
    const bucket = byModel.get(entry.model)
    if (bucket) bucket.push(entry)
    else byModel.set(entry.model, [entry])
  }

  const out: string[] = []
  out.push("## Model Performance Benchmark")
  out.push(`Total requests: ${sliced.length}`)
  if (options.model) out.push(`Filter: ${options.model}`)
  out.push("")

  for (const [model, entries] of byModel) {
    const ttfts = present(entries.map((e) => e.ttft_ms))
    const latencies = present(entries.map((e) => e.latency_ms))
    const tps = present(entries.map((e) => e.tps))

    const sum = (pick: (e: LogEntry) => number) =>
      entries.reduce((total, e) => total + pick(e), 0)

    out.push(`### ${model}`)
    out.push(`  Requests: ${entries.length}`)
    out.push("")
    out.push("  **Latency:**")
    out.push(
      `    TTFT:  avg ${formatMs(mean(ttfts))} | min ${formatMs(ttfts.length ? Math.min(...ttfts) : null)} | max ${formatMs(ttfts.length ? Math.max(...ttfts) : null)}`,
    )
    out.push(
      `    Total: avg ${formatMs(mean(latencies))} | min ${formatMs(latencies.length ? Math.min(...latencies) : null)} | max ${formatMs(latencies.length ? Math.max(...latencies) : null)}`,
    )
    out.push("")
    out.push("  **Throughput:**")
    out.push(
      `    TPS:  avg ${formatNum(mean(tps))} | max ${formatNum(tps.length ? Math.max(...tps) : null)}`,
    )
    out.push("")
    out.push("  **Tokens:**")
    out.push(`    Input:     ${formatNum(sum((e) => e.inputTokens))}`)
    out.push(`    Output:    ${formatNum(sum((e) => e.outputTokens))}`)
    out.push(`    Reasoning: ${formatNum(sum((e) => e.reasoningTokens))}`)
    out.push(
      `    Cache R/W: ${formatNum(sum((e) => e.cacheReadTokens))} / ${formatNum(sum((e) => e.cacheWriteTokens))}`,
    )
    out.push("")
    out.push(`  **Cost:** $${sum((e) => e.cost).toFixed(4)}`)

    if (entries.length <= 5) {
      out.push("")
      out.push("  Recent entries:")
      for (const e of entries) {
        out.push(
          `    ${e.ts} | ${formatMs(e.ttft_ms)} TTFT | ${formatNum(e.tps)} tok/s | ${formatMs(e.latency_ms)} | cost $${e.cost.toFixed(4)}`,
        )
      }
    }
    out.push("")
  }

  return out.join("\n")
}