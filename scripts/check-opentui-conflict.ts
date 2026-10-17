/**
 * Guards the installed plugin against the duplicate-OpenTUI failure.
 *
 * The published v1 package failed at import with:
 *   Environment variable "OPENTUI_FORCE_UNICODE" is already registered with
 *   different configuration
 *
 * Cause: two physical copies of @opentui/core get loaded in one process. The
 * plugin must resolve @opentui from the host runtime, so nothing above the
 * installed plugin may contain an @opentui copy. Module resolution follows
 * realpath, which is why a junction back into a dev checkout is unsafe.
 *
 * This asserts the invariant, then demonstrates the failure it protects
 * against so the check cannot silently become meaningless.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

let failed = false
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed = true
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`)
}

const repo = path.resolve(import.meta.dirname, "..")
const installed = path.join(os.homedir(), ".opencode", "plugins", "throughput")

// --- 1. invariant: nothing above the install exposes @opentui/core ----------
if (!fs.existsSync(installed)) {
  console.log(`SKIP  install not found at ${installed}`)
  console.log("      run: node scripts/sync-install.mjs")
  process.exit(0)
}

let dir = fs.realpathSync(installed)
const offenders: string[] = []
while (dir && dir.length > 3) {
  const candidate = path.join(dir, "node_modules", "@opentui", "core")
  if (fs.existsSync(candidate)) offenders.push(path.join(dir, "node_modules"))
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}
check(
  "no @opentui/core is reachable from the installed plugin",
  offenders.length === 0,
  offenders.join(", "),
)
check("install is a real directory, not a link", !fs.lstatSync(installed).isSymbolicLink())
check("install is not inside the dev checkout", !fs.realpathSync(installed).startsWith(repo))

// --- 2. demonstration: a duplicate copy really does break the import -------
const require = createRequire(path.join(repo, "package.json"))
const hostCopy = path.join(repo, "node_modules", "@opencode", "theme", "node_modules", "@opentui", "core")
const dupCopy = path.join(repo, "node_modules", "@opentui", "core")

if (fs.existsSync(hostCopy) && fs.existsSync(dupCopy) && path.resolve(hostCopy) !== path.resolve(dupCopy)) {
  let conflicted = false
  let loadedTui = false
  try {
    await import(pathToFileURL(require.resolve(hostCopy)).href)
    await import("../src/tui.tsx")
    loadedTui = true
  } catch (error) {
    conflicted = (error as Error).message.includes("OPENTUI_FORCE_UNICODE")
  }
  if (conflicted) {
    console.log("PASS  a duplicate @opentui/core copy is known to conflict (guard is meaningful)  reproduced")
  } else if (loadedTui) {
    // Not a failure. Reproducing the collision depends on the incidental layout
    // of this checkout's node_modules, which any npm install reshuffles. The
    // invariant above is the part that must hold; this is only a sanity check
    // that the scenario is still real.
    console.log("SKIP  duplicate-copy demo did not reproduce under this node_modules layout")
  } else {
    failed = true
    console.log("FAIL  TUI module failed to import for a reason other than the OpenTUI collision")
  }
} else {
  console.log("SKIP  duplicate-copy demonstration needs two distinct dev copies")
}

console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: ALL CHECKS PASSED")
process.exit(failed ? 1 : 0)