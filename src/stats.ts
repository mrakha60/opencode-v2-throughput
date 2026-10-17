import type { LogEntry, ModelStats } from "./types.js"

export function emptyStats(model: string): ModelStats {
  return {
    model,
    count: 0,
    avgTTFT: 0,
    avgTPS: 0,
    avgLatency: 0,
    minTTFT: Infinity,
    maxTTFT: 0,
    minLatency: Infinity,
    maxLatency: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    lastUpdated: 0,
  }
}

/**
 * Folds one completed request into the per-model aggregate.
 * Averages are running means, so they are updated incrementally rather than
 * recomputed over the whole log.
 */
export function updateStats(stats: Map<string, ModelStats>, key: string, entry: LogEntry): void {
  const existing = stats.get(key)
  if (!existing) {
    const fresh = emptyStats(key)
    fresh.count = 1
    fresh.avgTTFT = entry.ttft_ms ?? 0
    fresh.avgTPS = entry.tps ?? 0
    fresh.avgLatency = entry.latency_ms ?? 0
    fresh.minTTFT = entry.ttft_ms ?? Infinity
    fresh.maxTTFT = entry.ttft_ms ?? 0
    fresh.minLatency = entry.latency_ms ?? Infinity
    fresh.maxLatency = entry.latency_ms ?? 0
    fresh.totalInputTokens = entry.inputTokens
    fresh.totalOutputTokens = entry.outputTokens
    fresh.totalReasoningTokens = entry.reasoningTokens
    fresh.totalCacheReadTokens = entry.cacheReadTokens
    fresh.totalCacheWriteTokens = entry.cacheWriteTokens
    fresh.totalCost = entry.cost
    fresh.lastUpdated = Date.now()
    stats.set(key, fresh)
    return
  }

  const c = existing.count + 1
  existing.count = c
  existing.avgTTFT = (existing.avgTTFT * (c - 1) + (entry.ttft_ms ?? 0)) / c
  existing.avgTPS = (existing.avgTPS * (c - 1) + (entry.tps ?? 0)) / c
  existing.avgLatency = (existing.avgLatency * (c - 1) + (entry.latency_ms ?? 0)) / c
  if (entry.ttft_ms != null) {
    existing.minTTFT = Math.min(existing.minTTFT, entry.ttft_ms)
    existing.maxTTFT = Math.max(existing.maxTTFT, entry.ttft_ms)
  }
  if (entry.latency_ms != null) {
    existing.minLatency = Math.min(existing.minLatency, entry.latency_ms)
    existing.maxLatency = Math.max(existing.maxLatency, entry.latency_ms)
  }
  existing.totalInputTokens += entry.inputTokens
  existing.totalOutputTokens += entry.outputTokens
  existing.totalReasoningTokens += entry.reasoningTokens
  existing.totalCacheReadTokens += entry.cacheReadTokens
  existing.totalCacheWriteTokens += entry.cacheWriteTokens
  existing.totalCost += entry.cost
  existing.lastUpdated = Date.now()
}

export type Totals = { count: number; cost: number }

export function totalCount(stats: readonly ModelStats[]): number {
  return stats.reduce((sum, s) => sum + s.count, 0)
}

export function totalCost(stats: readonly ModelStats[]): number {
  return stats.reduce((sum, s) => sum + s.totalCost, 0)
}