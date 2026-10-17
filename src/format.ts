export function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return n.toFixed(n >= 100 ? 0 : 1)
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "N/A"
  if (ms >= 60_000) return (ms / 60_000).toFixed(1) + "m"
  if (ms >= 1_000) return (ms / 1_000).toFixed(1) + "s"
  return ms.toFixed(0) + "ms"
}

export const formatTokenCount = formatNum

export function getModelKey(providerID: string, modelID: string): string {
  return providerID && modelID ? `${providerID}/${modelID}` : modelID || providerID || "unknown"
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(1, max - 1)) + "."
}

/** Single-line metrics summary, used for toast notifications and log lines. */
export function buildSummaryLine(entry: {
  modelID: string
  ttft_ms: number | null
  tps: number | null
  latency_ms: number | null
  inputTokens: number
  outputTokens: number
}): string {
  return [
    truncate(entry.modelID, 28),
    formatMs(entry.ttft_ms) + " TTFT",
    formatNum(entry.tps) + " tok/s",
    formatMs(entry.latency_ms),
    "↑" + formatNum(entry.inputTokens) + " ↓" + formatNum(entry.outputTokens),
  ].join(" | ")
}

/** One fixed-width line for the `throughput.md` rolling log. */
export function buildMarkdownLine(entry: {
  ts: string
  modelID: string
  ttft_ms: number | null
  tps: number | null
  latency_ms: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cost: number
  finish: string | undefined
}): string {
  const base =
    `${entry.ts} | ${entry.modelID} | TTFT ${formatMs(entry.ttft_ms)} | ` +
    `TPS ${formatNum(entry.tps)} tok/s | Latency ${formatMs(entry.latency_ms)} | ` +
    `↑${formatNum(entry.inputTokens)} ↓${formatNum(entry.outputTokens)} ↓r${formatNum(entry.reasoningTokens)} | ` +
    `Cost $${entry.cost.toFixed(4)}`
  return entry.finish && entry.finish !== "stop" ? `${base} | ${entry.finish}` : base
}