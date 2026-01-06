/**
 * Conditional debug logger for Claude Code hooks.
 *
 * Debug logging enabled ONLY in development mode (BRV_ENV=development).
 * Error logging always enabled (production and development).
 * Logs are stored in the global logs directory (XDG_STATE_HOME on Linux, ~/Library/Logs on macOS).
 * Log files are automatically rotated when they exceed 5MB.
 */
import {appendFileSync, existsSync, mkdirSync, statSync, unlinkSync} from 'node:fs'
import {dirname, join} from 'node:path'

import {getGlobalLogsDir} from '../../utils/global-logs-path.js'
import {MAX_LOG_SIZE} from './constants.js'

/** Whether debug logging is enabled (development mode only) */
const DEBUG_ENABLED = process.env.BRV_ENV === 'development'

/** Full path to the hook debug log file */
const LOG_PATH = join(getGlobalLogsDir(), 'hook-debug.log')

/**
 * Ensure the log directory exists.
 */
const ensureLogDirectory = (): void => {
  const logDir = dirname(LOG_PATH)
  if (!existsSync(logDir)) {
    mkdirSync(logDir, {recursive: true})
  }
}

/**
 * Rotate log file if it exceeds the maximum size.
 * Simple rotation: just delete the old file and start fresh.
 */
const rotateLogIfNeeded = (): void => {
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_LOG_SIZE) {
      unlinkSync(LOG_PATH)
    }
  } catch {
    /** Ignore rotation errors */
  }
}

/**
 * Log a debug message to the hook debug log.
 *
 * Only logs when BRV_ENV=development (development mode only).
 * Messages are formatted as: [timestamp] [PREFIX] message
 *
 * @param prefix - Log prefix (e.g., 'PROMPT', 'STOP', 'SESSION')
 * @param step - Description of the current step or operation
 * @param data - Optional data to include (will be JSON stringified)
 *
 * @example
 * debugLog('PROMPT', '=== HOOK START ===')
 * debugLog('PROMPT', 'Parsed input', {prompt: 'Hello', sessionId: 'abc123'})
 * debugLog('SESSION', 'Failed to read session', {error: 'File not found'})
 */
export const debugLog = (prefix: string, step: string, data?: unknown): void => {
  if (!DEBUG_ENABLED) {
    return
  }

  try {
    ensureLogDirectory()
    rotateLogIfNeeded()

    const timestamp = new Date().toISOString()
    const msg = data === undefined ? step : `${step}: ${JSON.stringify(data, null, 2)}`

    appendFileSync(LOG_PATH, `[${timestamp}] [${prefix}] ${msg}\n`)
  } catch {
    /** Silent fail */
  }
}

/**
 * Check if debug logging is enabled.
 * @returns True if BRV_ENV=development
 */
export const isDebugEnabled = (): boolean => DEBUG_ENABLED

/**
 * Log an error to hook logs (always logs in production and development).
 * Follows the same pattern as process-logger errorLog().
 *
 * @param prefix - Log prefix (e.g., 'HOOK', 'SESSION')
 * @param error - Error object or error message string
 * @param context - Optional context string (e.g., 'UserPromptSubmit', 'Stop')
 *
 * @example
 * hookErrorLog('HOOK', new Error('Failed to connect'), 'UserPromptSubmit')
 * hookErrorLog('HOOK', 'Connection timeout', 'Stop')
 */
export const hookErrorLog = (prefix: string, error: Error | string, context?: string): void => {
  try {
    ensureLogDirectory()
    rotateLogIfNeeded()

    const timestamp = new Date().toISOString()
    const errorMessage = error instanceof Error ? error.message : error
    const errorStack = error instanceof Error ? error.stack : undefined
    const contextStr = context ? ` (${context})` : ''

    const errorLines = [`[${timestamp}] [${prefix}] ERROR${contextStr}: ${errorMessage}`]

    if (errorStack) {
      // Add indented stack trace (skip first line which is the error message)
      const stackLines = errorStack.split('\n').slice(1)
      for (const line of stackLines) {
        errorLines.push(`    ${line}`)
      }
    }

    appendFileSync(LOG_PATH, errorLines.join('\n') + '\n')
  } catch {
    // Silent fail - don't crash hooks
  }
}
