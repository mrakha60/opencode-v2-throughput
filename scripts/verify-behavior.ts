/**
 * Exercises the server plugin against a scripted V2 event stream.
 *
 * Verifies the metric arithmetic, the durable log, the per-location markdown
 * file, and the namespaced benchmark tool.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "throughput-test-"))
process.env.USERPROFILE = sandbox
process.env.HOME = sandbox

const locationDirectory = path.join(sandbox, "project")
fs.mkdirSync(locationDirectory, { recursive: true })

const { default: plugin } = await import("../src/index.ts")
const { readLogs } = await import("../src/log.ts")

let failed = false
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed = true
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`)
}

// --- scripted V2 event stream ------------------------------------------------
const stepStarted = (messageID: string, at: number, providerID: string, id: string) => ({
  type: "session.step.started" as const,
  created: at,
  data: {
    sessionID: "ses_1",
    assistantMessageID: messageID,
    agent: "build",
    model: { providerID, id },
    started: at,
  },
})

const textStarted = (messageID: string, at: number) => ({
  type: "session.text.started" as const,
  created: at,
  data: { sessionID: "ses_1", assistantMessageID: messageID, ordinal: 0 },
})

const stepEnded = (
  messageID: string,
  at: number,
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } },
  cost: number,
  finish = "stop",
) => ({
  type: "session.step.ended" as const,
  created: at,
  data: { sessionID: "ses_1", assistantMessageID: messageID, finish, cost, tokens },
})

const events = [
  // Normal text response.
  stepStarted("msg_1", 1000, "anthropic", "claude-sonnet-4-5"),
  textStarted("msg_1", 2200),
  stepEnded("msg_1", 4200, { input: 1200, output: 892, reasoning: 0, cache: { read: 500, write: 200 } }, 0.0234),
  // Tool-call-only step: no text, so TTFT is unknown but latency is not.
  stepStarted("msg_2", 5000, "anthropic", "claude-sonnet-4-5"),
  stepEnded("msg_2", 5300, { input: 1500, output: 0, reasoning: 0, cache: { read: 500, write: 200 } }, 0.0041),
  // Second model, reasoning-first.
  stepStarted("msg_3", 6000, "openai", "gpt-5"),
  { type: "session.reasoning.started" as const, created: 6400, data: { sessionID: "ses_1", assistantMessageID: "msg_3", ordinal: 0 } },
  stepEnded("msg_3", 8400, { input: 300, output: 1600, reasoning: 400, cache: { read: 0, write: 0 } }, 0.0512),
]

// --- fake plugin context -----------------------------------------------------
let capturedTool: any = null
let namespaces: any[] = []

const ctx = {
  app: { name: "opencode", version: "2.0.32", channel: "stable" },
  location: { directory: locationDirectory, project: { id: "prj_1" } },
  options: {},
  event: {
    subscribe({ signal }: { signal?: AbortSignal } = {}) {
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            if (signal?.aborted) return
            yield event
            await new Promise((r) => setTimeout(r, 0))
          }
          let waited = 0
          while (!signal?.aborted && waited < 2000) {
            await new Promise((r) => setTimeout(r, 5))
            waited += 5
          }
        },
      }
    },
  },
  tool: {
    async transform(cb: (editor: any) => void) {
      cb({
        namespace: (n: any) => namespaces.push(n),
        add: (t: any) => {
          capturedTool = t
        },
      })
      return { dispose: async () => {} }
    },
  },
} as any

const cleanup = await plugin.setup(ctx)
await new Promise((r) => setTimeout(r, 300))

// --- assertions --------------------------------------------------------------
const logs = readLogs()
check("wrote one log entry per model request", logs.length === 3, `got ${logs.length}`)

const first = logs.find((l) => l.messageID === "msg_1")!
check("TTFT = first token - step start", first?.ttft_ms === 1200, `${first?.ttft_ms}`)
check("latency = step end - step start", first?.latency_ms === 3200, `${first?.latency_ms}`)
check(
  "TPS excludes the TTFT wait",
  Math.abs((first?.tps ?? 0) - 892 / 2000 * 1000) < 1e-6,
  `${first?.tps}`,
)
check("model key is provider/model", first?.model === "anthropic/claude-sonnet-4-5", `${first?.model}`)
check("cache tokens mapped", first?.cacheReadTokens === 500 && first?.cacheWriteTokens === 200)
check("cost captured", Math.abs((first?.cost ?? 0) - 0.0234) < 1e-9)

const second = logs.find((l) => l.messageID === "msg_2")!
check("TTFT unknown when no token streamed", second?.ttft_ms === null, `${second?.ttft_ms}`)
check("latency still recorded", second?.latency_ms === 300, `${second?.latency_ms}`)
check("TPS null when no output tokens", second?.tps === null, `${second?.tps}`)

const third = logs.find((l) => l.messageID === "msg_3")!
check("reasoning counts as first token", third?.ttft_ms === 400, `${third?.ttft_ms}`)
check("reasoning tokens mapped", third?.reasoningTokens === 400, `${third?.reasoningTokens}`)

const markdown = path.join(locationDirectory, ".opencode", "throughput.md")
check("markdown written to location", fs.existsSync(markdown))
check(
  "markdown has one line per request",
  fs.readFileSync(markdown, "utf-8").trim().split("\n").length === 3,
)

// benchmark tool
check("tool registered", capturedTool != null)
check("tool name is benchmark", capturedTool?.name === "benchmark", `${capturedTool?.name}`)
check("tool namespaced under throughput", capturedTool?.options?.namespace === "throughput")
check("namespace declared", namespaces.some((n) => n.name === "throughput"))

const report = await capturedTool.execute({ model: "claude" }, { signal: new AbortController().signal })
check("benchmark report renders", typeof report?.content === "string" && report.content.includes("Model Performance Benchmark"))
check("benchmark filters to one model", report.content.includes("### anthropic/claude-sonnet-4-5") && !report.content.includes("### openai/gpt-5"))
check("benchmark reports both requests for that model", report.content.includes("Requests: 2"))

const limited = await capturedTool.execute({ last: 1 }, { signal: new AbortController().signal })
check("benchmark last=1 returns a single request", limited.content.includes("Total requests: 1"))

// cleanup
await cleanup()
check("cleanup returned a function", typeof cleanup === "function")

// --- resilience: a dropped stream must resubscribe, not die -----------------
fs.writeFileSync(path.join(sandbox, ".opencode", "throughput.jsonl"), "")

let subscribeCalls = 0
const reconnectCtx = {
  app: { name: "opencode", version: "2.0.32", channel: "stable" },
  location: { directory: locationDirectory, project: { id: "prj_1" } },
  options: {},
  event: {
    subscribe() {
      subscribeCalls++
      if (subscribeCalls === 1) throw new Error("simulated connection drop")
      return {
        async *[Symbol.asyncIterator]() {
          yield stepStarted("msg_r1", 10000, "anthropic", "claude-sonnet-4-5")
          yield textStarted("msg_r1", 11000)
          yield stepEnded("msg_r1", 13000, { input: 10, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }, 0.001)
          let waited = 0
          while (waited < 1500) {
            await new Promise((r) => setTimeout(r, 5))
            waited += 5
          }
        },
      }
    },
  },
  tool: {
    async transform() {
      return { dispose: async () => {} }
    },
  },
} as any

const reconnectCleanup = await plugin.setup(reconnectCtx)
await new Promise((r) => setTimeout(r, 600))
await reconnectCleanup()

check("resubscribed after the stream dropped", subscribeCalls >= 2, `calls=${subscribeCalls}`)
const recovered = readLogs().find((l) => l.messageID === "msg_r1")
check("recorded metrics after reconnect", recovered != null)
check("post-reconnect metrics are correct", recovered?.latency_ms === 3000 && recovered?.ttft_ms === 1000, `${recovered?.latency_ms}/${recovered?.ttft_ms}`)

// --- a throwing handler must not kill the subscription ----------------------
fs.writeFileSync(path.join(sandbox, ".opencode", "throughput.jsonl"), "")

const malformedCtx = {
  app: { name: "opencode", version: "2.0.32", channel: "stable" },
  location: { directory: locationDirectory, project: { id: "prj_1" } },
  options: {},
  event: {
    subscribe() {
      return {
        async *[Symbol.asyncIterator]() {
          // Missing `data` entirely: the handler must throw internally.
          yield { type: "session.step.started", created: 1 }
          yield { type: "session.step.ended", created: 2, data: null }
          yield stepStarted("msg_ok", 9000, "anthropic", "claude-sonnet-4-5")
          yield textStarted("msg_ok", 9500)
          yield stepEnded("msg_ok", 12000, { input: 5, output: 50, reasoning: 0, cache: { read: 0, write: 0 } }, 0.002)
          let waited = 0
          while (waited < 1500) {
            await new Promise((r) => setTimeout(r, 5))
            waited += 5
          }
        },
      }
    },
  },
  tool: { async transform() { return { dispose: async () => {} } } },
} as any

const malformedCleanup = await plugin.setup(malformedCtx)
await new Promise((r) => setTimeout(r, 400))
await malformedCleanup()

const survived = readLogs().find((l) => l.messageID === "msg_ok")
check("malformed events did not kill the subscription", survived != null)
check("metrics after malformed events are correct", survived?.latency_ms === 3000 && survived?.ttft_ms === 500, `${survived?.latency_ms}/${survived?.ttft_ms}`)

// --- bounded log reads -------------------------------------------------------
check("readLogs honours its limit", readLogs(1).length <= 1, `got ${readLogs(1).length}`)

fs.rmSync(sandbox, { recursive: true, force: true })
console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: ALL CHECKS PASSED")
process.exit(failed ? 1 : 0)