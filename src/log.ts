import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { LogEntry } from "./types.js"
import { buildMarkdownLine } from "./format.js"

/** Durable cross-session log. Kept at the V1 path so existing history survives the upgrade. */
export const LOG_DIR = path.join(os.homedir(), ".opencode")
export const LOG_FILE = path.join(LOG_DIR, "throughput.jsonl")

/** Per-project rolling log, written under the loaded location. */
export function throughputMarkdownFile(directory: string): string {
  return path.join(directory, ".opencode", "throughput.md")
}

export function appendLog(entry: LogEntry): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8")
  } catch {
    // Never let telemetry break a session.
  }
}

export function writeThroughputMarkdown(directory: string, entry: LogEntry): void {
  try {
    const file = throughputMarkdownFile(directory)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, buildMarkdownLine(entry) + "\n", "utf-8")
  } catch {
    // A read-only or missing location must not break a session.
  }
}

export function readLogs(): LogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return []
    return fs
      .readFileSync(LOG_FILE, "utf-8")
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LogEntry]
        } catch {
          // Tolerate a torn final line from an interrupted append.
          return []
        }
      })
  } catch {
    return []
  }
}