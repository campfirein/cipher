/**
 * Unified Process Logger - Single log file per session.
 *
 * Logs are stored following platform conventions:
 * - Windows: %LOCALAPPDATA%/brv/logs/brv-{timestamp}.log
 * - macOS: ~/Library/Logs/brv/brv-{timestamp}.log
 * - Linux: $XDG_STATE_HOME/brv/logs/brv-{timestamp}.log
 *
 * Each session creates a new log file with timestamp.
 */

import {appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {getGlobalLogsDir} from './global-logs-path.js'

/** Current session's log file path (set on init) */
let sessionLogPath: string | undefined

/**
 * Get the logs directory path.
 */
function getLogsDir(): string {
  return getGlobalLogsDir()
}

/**
 * Ensure logs directory exists.
 * Silently ignores errors to prevent crashes.
 */
function ensureLogDir(): void {
  try {
    const logsDir = getLogsDir()
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, {recursive: true})
    }
  } catch {
    // Silently ignore - directory creation may fail due to permissions
    // Logging will fail gracefully later when trying to write
  }
}

/** Max age for log files in milliseconds (30 days) */
const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Clean up log files older than 30 days.
 * Runs silently - errors are ignored to not affect the main process.
 */
function cleanupOldLogs(): void {
  try {
    const logsDir = getLogsDir()
    if (!existsSync(logsDir)) return

    const now = Date.now()
    const files = readdirSync(logsDir)

    for (const file of files) {
      if (!file.endsWith('.log')) continue

      const filePath = join(logsDir, file)
      const stats = statSync(filePath)
      const age = now - stats.mtimeMs

      if (age > LOG_MAX_AGE_MS) {
        unlinkSync(filePath)
      }
    }
  } catch {
    // Silently ignore - don't crash the process
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
 * Generate session log filename with timestamp.
 */
function generateSessionLogFilename(): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  return `brv-${timestamp}.log`
}

/**
 * Get current session's log file path.
 * Uses BRV_SESSION_LOG env var if set (for child processes),
 * otherwise creates new session file.
 */
function getLogPath(): string {
  if (!sessionLogPath) {
    // Check if parent process set the log path
    const envLogPath = process.env.BRV_SESSION_LOG
    if (envLogPath) {
      sessionLogPath = envLogPath
    } else {
      // Try to create log directory, but don't crash if it fails
      // getLogsDir() has its own fallback to tmpdir() via getGlobalLogsDir()
      try {
        ensureLogDir()
      } catch {
        // Directory creation failed - subsequent writes will also fail silently
        // This prevents crash when getSessionLogPath() is called from process-manager
      }

      sessionLogPath = join(getLogsDir(), generateSessionLogFilename())
    }
  }

  return sessionLogPath
}

/**
 * Initialize session log - creates a new log file for this session.
 * Should be called once when the main process starts.
 */
export function initSessionLog(): void {
  if (sessionLogPath) return

  try {
    ensureLogDir()
    cleanupOldLogs()
    sessionLogPath = join(getLogsDir(), generateSessionLogFilename())

    const timestamp = formatTimestamp()
    const header = [
      '='.repeat(70),
      `BRV Session Log - Started: ${timestamp}`,
      `CWD: ${process.cwd()}`,
      `Node: ${process.version} | Platform: ${process.platform} | PID: ${process.pid}`,
      '='.repeat(70),
      '',
    ].join('\n')
    writeFileSync(sessionLogPath, header)
  } catch {
    // Silently ignore - don't crash the process
  }
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

/**
 * Log a transport event (for TUI monitoring).
 */
export function eventLog(eventName: string, data?: unknown): void {
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  processLog(`[Event] ${eventName}${dataStr}`)
}

/**
 * Log an error with full details.
 */
export function errorLog(error: Error | string, context?: string): void {
  const errorMessage = error instanceof Error ? error.message : error
  const errorStack = error instanceof Error ? error.stack : undefined
  const contextStr = context ? ` (${context})` : ''

  processLog(`[ERROR]${contextStr} ${errorMessage}`)
  if (errorStack) {
    const indentedStack = errorStack
      .split('\n')
      .slice(1)
      .map((line) => `         ${line}`)
      .join('\n')
    processLog(indentedStack)
  }
}

/**
 * Log a crash with full environment details.
 * Everything goes to the session log file.
 * Never throws - always returns a log path (even if logging failed).
 *
 * @returns The path to the log file (for user feedback)
 */
export function crashLog(error: Error | string, contextStr = 'Unknown'): string {
  let logPath: string

  try {
    const errorMessage = error instanceof Error ? error.message : error
    const errorStack = error instanceof Error ? error.stack : undefined
    const timestamp = formatTimestamp()
    logPath = getLogPath()

    ensureLogDir()

    const crashContent = [
      '',
      '!'.repeat(70),
      `CRASH at ${timestamp}`,
      '!'.repeat(70),
      '',
      `Context: ${contextStr}`,
      `Message: ${errorMessage}`,
      '',
      'Stack Trace:',
      errorStack ?? '(No stack trace available)',
      '',
      'Environment:',
      `  Node.js: ${process.version}`,
      `  Platform: ${process.platform}`,
      `  Arch: ${process.arch}`,
      `  CWD: ${process.cwd()}`,
      `  PID: ${process.pid}`,
      '',
      'Memory Usage:',
      JSON.stringify(process.memoryUsage(), null, 2)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
      '',
      '!'.repeat(70),
      '',
    ].join('\n')

    appendFileSync(logPath, crashContent)
  } catch {
    // If we can't write or get path, return a fallback path for user feedback
    logPath = logPath! || join(getGlobalLogsDir(), 'brv-crash.log')
  }

  return logPath
}

/**
 * Get the path to the current session's log file.
 * Never throws - returns fallback path if session path unavailable.
 */
export function getSessionLogPath(): string {
  try {
    return getLogPath()
  } catch {
    // Fallback to a predictable path if getLogPath fails
    return join(getGlobalLogsDir(), 'brv-session.log')
  }
}
