/**
 * Transport Event Logger
 *
 * Logs transport events to a file for debugging in development mode.
 */

import fs from 'node:fs'
import path from 'node:path'

import {BRV_DIR, isDevelopment} from './environment.js'

const TRANSPORT_LOG_FILE = path.join(BRV_DIR, 'transport-events.log')

function formatTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Log a transport event to file (development mode only).
 */
export function logTransportEvent(eventName: string, data: unknown): void {
  if (!isDevelopment()) return

  // eslint-disable-next-line perfectionist/sort-objects
  const line = JSON.stringify({event: eventName, data, timestamp: formatTimestamp()}, null, 2) + '\n'
  try {
    fs.appendFileSync(TRANSPORT_LOG_FILE, line)
  } catch {
    // Ignore
  }
}

/**
 * Initialize the transport log file (clears previous content).
 */
export function initTransportLog(): void {
  if (!isDevelopment()) return

  try {
    fs.writeFileSync(TRANSPORT_LOG_FILE, `# Transport Events - ${formatTimestamp()}\n`)
  } catch {
    // Ignore
  }
}
