import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname} from 'node:path'

import type {IHeartbeatWriter} from '../../core/interfaces/daemon/i-heartbeat-writer.js'

import {HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_THRESHOLD_MS} from '../../constants.js'

export interface HeartbeatWriterOptions {
  readonly filePath: string
  readonly intervalMs?: number
  readonly log: (message: string) => void
}

/**
 * File-based heartbeat writer that writes the current epoch
 * timestamp to a file at regular intervals.
 *
 * Uses recursive setTimeout (not setInterval) to prevent callback overlap.
 * Uses synchronous file writes for reliability during crashes.
 */
export class HeartbeatWriter implements IHeartbeatWriter {
  private dirEnsured = false
  private readonly filePath: string
  private readonly intervalMs: number
  private isRunning = false
  private readonly log: (message: string) => void
  private timeoutId: ReturnType<typeof setTimeout> | undefined

  constructor(options: HeartbeatWriterOptions) {
    this.filePath = options.filePath
    this.intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS
    this.log = options.log
  }

  refresh(): void {
    if (!this.isRunning) return
    this.writeHeartbeat()
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.writeHeartbeat()
    this.scheduleNext()
    this.log('Heartbeat started')
  }

  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }

    // Intentionally does NOT delete the heartbeat file.
    // During overlapping shutdown/startup sequences, deleting the file
    // could remove a NEW daemon's heartbeat, causing clients to see
    // 'heartbeat_stale' and cascade-kill the replacement daemon.
    // The file naturally becomes stale (>15s) when writes stop,
    // and cleanupStaleDaemonFiles() handles cleanup during next spawn.
    this.log('Heartbeat stopped')
  }

  private ensureDir(): void {
    if (!this.dirEnsured) {
      try {
        mkdirSync(dirname(this.filePath), {recursive: true})
        this.dirEnsured = true
      } catch {
        // Ignore — write will fail and be caught
      }
    }
  }

  private scheduleNext(): void {
    if (!this.isRunning) return
    this.timeoutId = setTimeout(() => {
      this.writeHeartbeat()
      this.scheduleNext()
    }, this.intervalMs)
  }

  private writeHeartbeat(): void {
    try {
      this.ensureDir()
      writeFileSync(this.filePath, String(Date.now()))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`Heartbeat write failed: ${message}`)
    }
  }
}

/**
 * Checks whether the heartbeat file is stale (or missing).
 *
 * Returns true if:
 * - File does not exist
 * - File cannot be read
 * - File content is not a valid timestamp
 * - Timestamp is older than thresholdMs (default 15s)
 */
export function isHeartbeatStale(filePath: string, thresholdMs?: number): boolean {
  const threshold = thresholdMs ?? HEARTBEAT_STALE_THRESHOLD_MS
  try {
    const content = readFileSync(filePath, 'utf8')
    const timestamp = Number(content.trim())
    if (!Number.isFinite(timestamp) || timestamp <= 0) return true
    return Date.now() - timestamp > threshold
  } catch {
    return true
  }
}
