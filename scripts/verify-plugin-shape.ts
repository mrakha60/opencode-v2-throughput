/**
 * Verifies both entrypoints satisfy OpenCode's exact V2 plugin validator.
 *
 * The validator below is copied verbatim from the shipped opencode CLI
 * (function `iDt`, guarding `throw Error("Invalid V2 TUI plugin module: ...")`).
 * It is the check that rejected opencode-throughput@2.1.0.
 */
import { readFileSync } from "node:fs"
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

// The plugin id must stay in lockstep with the package name. The upstream fork
// shipped the same id under a different package name, which made the two
// collide with "Duplicate plugin ID" whenever both were installed.
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { name: string }
for (const [label, spec] of [
  ["server plugin  (./)", "../src/index.ts"],
  ["tui plugin     (./tui)", "../src/tui.tsx"],
] as const) {
  const mod = await import(spec)
  const def = (mod as { default?: { id?: unknown } }).default
  check(
    `${label} id matches the package name`,
    def?.id === pkg.name,
    `id=${String(def?.id)} package=${pkg.name}`,
  )
}

// The V1 shape that caused the original failure must NOT be present anymore.
const legacy = { id: "opencode-throughput", tui: async () => {} }
check(
  "V1 shape ({id, tui}) would still be rejected",
  !isV2Plugin({ default: legacy }),
  "guard sanity check",
)

// A UTF-8 BOM in package.json breaks JSON parsing for anything stricter than
// npm, and it is trivially reintroduced by PowerShell's Set-Content.
for (const file of ["../package.json", "../tsconfig.json"]) {
  const bytes = readFileSync(new URL(file, import.meta.url))
  check(`${file} has no BOM`, bytes[0] !== 0xef, bytes[0] === 0xef ? "starts with EF BB BF" : "")
}

console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: ALL CHECKS PASSED")
process.exit(failed ? 1 : 0)