/**
 * Verifies both entrypoints satisfy OpenCode's exact V2 plugin validator.
 *
 * The validator below is copied verbatim from the shipped opencode CLI
 * (function `iDt`, guarding `throw Error("Invalid V2 TUI plugin module: ...")`).
 * It is the check that rejected opencode-throughput@2.1.0.
 */
function isV2Plugin(moduleExport: unknown): boolean {
  const def = (moduleExport as { default?: unknown })?.default
  return (
    typeof def === "object" &&
    def !== null &&
    "id" in def &&
    typeof (def as { id: unknown }).id === "string" &&
    (def as { id: string }).id.length > 0 &&
    "setup" in def &&
    typeof (def as { setup: unknown }).setup === "function"
  )
}

let failed = false

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed = true
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`)
}

for (const [label, spec] of [
  ["server plugin  (./)", "../src/index.ts"],
  ["tui plugin     (./tui)", "../src/tui.tsx"],
] as const) {
  try {
    const mod = await import(spec)
    const def = (mod as { default?: { id?: unknown } }).default as
      | { id?: unknown; setup?: unknown }
      | undefined

    check(`${label} module loads`, true)
    check(`${label} passes V2 validator`, isV2Plugin(mod), `id=${String(def?.id)}`)
    check(
      `${label} setup is a function`,
      typeof def?.setup === "function",
      `arity=${typeof def?.setup === "function" ? (def.setup as () => void).length : "n/a"}`,
    )
  } catch (error) {
    failed = true
    console.log(`FAIL  ${label} threw while loading: ${(error as Error).message}`)
  }
}

// The V1 shape that caused the original failure must NOT be present anymore.
const legacy = { id: "opencode-throughput", tui: async () => {} }
check(
  "V1 shape ({id, tui}) would still be rejected",
  !isV2Plugin({ default: legacy }),
  "guard sanity check",
)

console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: ALL CHECKS PASSED")
process.exit(failed ? 1 : 0)