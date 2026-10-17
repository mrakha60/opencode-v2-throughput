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

/** Keeps the log bounded. Roughly a few years of requests at a few per minute. */
const MAX_LOG_BYTES = 32 * 1024 * 1024
/** Chunk size used when reading the tail without loading the whole file. */
const TAIL_CHUNK = 1024 * 1024

export function appendLog(entry: LogEntry): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
    rotateIfNeeded()
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8")
  } catch {
    // Never let telemetry break a session.
  }
}

/** Trims the oldest half once the file passes MAX_LOG_BYTES, so it cannot grow forever. */
function rotateIfNeeded(): void {
  try {
    const { size } = fs.statSync(LOG_FILE)
    if (size <= MAX_LOG_BYTES) return
    const content = fs.readFileSync(LOG_FILE, "utf-8")
    const half = Math.floor(content.length / 2)
    const newline = content.indexOf("\n", half)
    fs.writeFileSync(LOG_FILE, content.slice(newline === -1 ? half : newline + 1), "utf-8")
  } catch {
    // Leave the log alone if trimming fails; losing history beats failing a request.
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

/**
 * Reads log entries. Reads at most `limit` entries from the tail of the file so
 * cost stays flat as the log grows, instead of parsing every line on each call.
 */
export function readLogs(limit = 5000): LogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return []
    const { size } = fs.statSync(LOG_FILE)
    const readFrom = Math.max(0, size - TAIL_CHUNK)
    const fd = fs.openSync(LOG_FILE, "r")
    try {
      const buffer = Buffer.alloc(size - readFrom)
      fs.readSync(fd, buffer, 0, buffer.length, readFrom)
      let text = buffer.toString("utf-8")
      // A chunk boundary can split the first line; drop the partial line.
      if (readFrom > 0) {
        const firstNewline = text.indexOf("\n")
        text = firstNewline === -1 ? "" : text.slice(firstNewline + 1)
      }
      return text
        .split("\n")
        .filter((line) => line.trim())
        .slice(-limit)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as LogEntry]
          } catch {
            // Tolerate a torn line from an interrupted append.
            return []
          }
        })
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }
}