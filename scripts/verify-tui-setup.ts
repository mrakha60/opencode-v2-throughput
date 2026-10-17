/**
 * Exercises the TUI plugin's setup/cleanup without rendering.
 *
 * setup() is where the realistic V2 API mistakes live (wrong context member
 * names, bad event types, a missing unsubscribe). Rendering the widget itself
 * needs a real terminal, so this deliberately stops short of that.
 */
type Listener = (event: any) => void

let failed = false
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed = true
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`)
}

const listeners = new Map<string, Set<Listener>>()
const on = (type: string, handler: Listener) => {
  const set = listeners.get(type) ?? new Set<Listener>()
  set.add(handler)
  listeners.set(type, set)
  return () => set.delete(handler)
}
const emit = (type: string, event: any) => {
  for (const handler of listeners.get(type) ?? []) handler(event)
}

const slots: any[] = []
const toasts: any[] = []
let unsubscribes = 0

const context = {
  options: {},
  location: { directory: process.cwd() },
  app: { version: "2.0.32", channel: "stable" },
  theme: {
    text: { base: "#fff", muted: "#888" },
    surface: () => ({}),
  },
  data: {
    on,
    listen: () => () => {},
  },
  ui: {
    slot: (claim: any) => {
      slots.push(claim)
      return () => {
        const i = slots.indexOf(claim)
        if (i >= 0) slots.splice(i, 1)
      }
    },
    toast: {
      show: (options: any) => {
        toasts.push(options)
      },
    },
  },
  storage: {},
  keymap: {},
} as any

const mod = await import("../src/tui.tsx")
const definition = (mod as any).default

check("default export has id and setup", typeof definition.id === "string" && typeof definition.setup === "function")
check("id is non-empty", definition.id.length > 0, definition.id)

const cleanup = await definition.setup(context)
check("setup completed without throwing", true)
check("claimed sidebar.content", slots.length === 1 && slots[0].append === "sidebar.content", JSON.stringify(slots[0]?.append))
check("slot claim provides render", typeof slots[0]?.render === "function")
check(
  "subscribed to the metric events",
  ["session.step.started", "session.text.started", "session.step.ended"].every((t) => listeners.has(t)),
  [...listeners.keys()].join(","),
)

// Drive one full request through the TUI handlers.
emit("session.step.started", {
  type: "session.step.started",
  created: 1000,
  data: { sessionID: "ses_1", assistantMessageID: "m1", agent: "build", model: { providerID: "anthropic", id: "claude-sonnet-4-5" }, started: 1000 },
})
emit("session.text.started", { type: "session.text.started", created: 2000, data: { sessionID: "ses_1", assistantMessageID: "m1", ordinal: 0 } })
emit("session.step.ended", {
  type: "session.step.ended",
  created: 4000,
  data: { sessionID: "ses_1", assistantMessageID: "m1", finish: "stop", cost: 0.5, tokens: { input: 10, output: 400, reasoning: 0, cache: { read: 0, write: 0 } } },
})

check("raised a toast per request", toasts.length === 1, JSON.stringify(toasts[0]?.variant))
check("toast carries a metrics summary", typeof toasts[0]?.message === "string" && toasts[0].message.includes("TTFT"), toasts[0]?.message)
check("toast is scoped to the session", toasts[0]?.sessionID === "ses_1")

// Render must reach the OpenTUI JSX runtime. There is no renderer mounted in a
// plain node process, so the only acceptable failure is "No renderer found":
// that proves the component was constructed and createElement was called.
// Any other error is a real defect in the widget.
let renderOutcome: string
try {
  const rendered = slots[0].render({ sessionID: "ses_1" })
  renderOutcome = rendered == null ? "returned null" : "rendered"
  check("render() produced output", true, renderOutcome)
} catch (error) {
  const message = (error as Error).message
  if (message.includes("No renderer found")) {
    check("widget builds and reaches the OpenTUI JSX runtime", true, "reached createElement; no renderer outside a terminal (expected)")
  } else {
    check("widget builds and reaches the OpenTUI JSX runtime", false, message.slice(0, 200))
  }
}

// A failed step must use the error variant.
emit("session.step.started", { type: "session.step.started", created: 5000, data: { sessionID: "ses_1", assistantMessageID: "m2", agent: "build", model: { providerID: "anthropic", id: "claude-sonnet-4-5" }, started: 5000 } })
emit("session.step.ended", { type: "session.step.ended", created: 6000, data: { sessionID: "ses_1", assistantMessageID: "m2", finish: "error", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
check("error finish uses the error variant", toasts[1]?.variant === "error", `${toasts[1]?.variant}`)

// Cleanup must release the slot and every listener.
await cleanup()
check("cleanup released the slot", slots.length === 0)
check("cleanup removed all listeners", listeners.size === 0 || [...listeners.values()].every((s) => s.size === 0), [...listeners.values()].map((s) => s.size).join(","))

console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: ALL CHECKS PASSED")
process.exit(failed ? 1 : 0)