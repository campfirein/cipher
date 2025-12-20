/**
 * Process Logger - File-based logging for Transport and Agent processes.
 *
 * Writes all process logs to .brv/brv.log instead of console.
 * This keeps the terminal clean while preserving debug information.
 */

import {appendFileSync, existsSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'

import {BRV_DIR} from '../constants.js'

/**
 * Get the log file path.
 * Uses process.cwd() which is the project root for worker processes.
 */
function getLogPath(): string {
  const brvDir = join(process.cwd(), BRV_DIR)
  return join(brvDir, 'brv.log')
}

/**
 * Ensure .brv directory exists.
 */
function ensureLogDir(): void {
  const brvDir = join(process.cwd(), BRV_DIR)
  if (!existsSync(brvDir)) {
    mkdirSync(brvDir, {recursive: true})
  }
}

/**
 * Format timestamp for log entries.
 */
function formatTimestamp(): string {
  const now = new Date()
  return now.toISOString().replace('T', ' ').slice(0, 23)
}

/**
 * Write a log entry to the log file.
 * Uses synchronous append for reliability in process shutdown scenarios.
 */
export function processLog(message: string): void {
  try {
    ensureLogDir()
    const timestamp = formatTimestamp()
    const logLine = `${timestamp} ${message}\n`
    appendFileSync(getLogPath(), logLine)
  } catch {
    // Silently ignore log failures - don't crash the process
  }
}

/**
 * Log with [Transport] prefix.
 */
export function transportLog(message: string): void {
  processLog(`[Transport] ${message}`)
}

/**
 * Log with [Agent] prefix.
 */
export function agentLog(message: string): void {
  processLog(`[Agent] ${message}`)
}

/**
 * Log with [ProcessManager] prefix.
 */
export function processManagerLog(message: string): void {
  processLog(`[ProcessManager] ${message}`)
}
