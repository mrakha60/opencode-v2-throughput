#!/usr/bin/env node
/**
 * Copies the plugin into an OpenCode plugin directory.
 *
 * A plain copy is deliberate. A symlink or junction looks convenient, but module
 * resolution follows realpath, so a link back into this repo makes the repo's
 * node_modules reachable and the plugin then loads a *second* @opentui/core.
 * Two copies abort at import time with:
 *   Environment variable "OPENTUI_FORCE_UNICODE" is already registered with
 *   different configuration
 *
 * The installed copy must have no node_modules above it, so OpenCode resolves
 * @opentui from its own runtime.
 *
 * Usage: node scripts/sync-install.mjs [targetDir]
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const source = path.resolve(import.meta.dirname, "..", "src")
const target = path.resolve(
  process.argv[2] ?? path.join(os.homedir(), ".opencode", "plugins", "throughput"),
)

if (!fs.existsSync(path.join(source, "index.ts"))) {
  console.error(`error: ${source} does not look like the plugin source`)
  process.exit(1)
}

// Remove a previous junction/symlink without following it into the target.
let existing = null
try {
  existing = fs.lstatSync(target)
} catch {
  /* not installed */
}
if (existing?.isSymbolicLink()) {
  fs.unlinkSync(target)
  existing = null
}

// Overwrite in place rather than delete and recreate. OpenCode watches plugin
// directories, and a removed-then-recreated directory is not always rescanned,
// which makes the plugin look like it vanished until a service restart.
if (existing && !existing.isDirectory()) {
  fs.rmSync(target, { recursive: true, force: true })
  existing = null
}
fs.mkdirSync(target, { recursive: true })

let copied = 0
for (const name of fs.readdirSync(source)) {
  const from = path.join(source, name)
  if (!fs.statSync(from).isFile()) continue
  if (!/\.(ts|tsx)$/.test(name)) continue
  fs.copyFileSync(from, path.join(target, name))
  copied++
}

// Drop stale sources that no longer exist in src/.
for (const name of fs.readdirSync(target)) {
  if (!/\.(ts|tsx)$/.test(name)) continue
  if (!fs.existsSync(path.join(source, name))) fs.rmSync(path.join(target, name))
}

console.log(`synced ${copied} file(s) -> ${target}`)

// Fail loudly if anything above the install exposes an @opentui copy.
let dir = fs.realpathSync(target)
while (dir && dir.length > 3) {
  const candidate = path.join(dir, "node_modules", "@opentui", "core")
  if (fs.existsSync(candidate)) {
    console.error(`error: ${dir}\\node_modules contains @opentui/core`)
    console.error("       the plugin would load a second OpenTUI core and fail to import")
    process.exit(1)
  }
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}
console.log("ok: no @opentui/core is reachable from the install path")