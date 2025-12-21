/**
 * Unified Process Logger - Single log file per session.
 *
 * All logs go to ~/.brv/logs/brv-{timestamp}.log:
 * - Process logs (Transport, Agent, ProcessManager)
 * - Transport events
 * - Errors and crashes
 *
 * Each session creates a new log file with timestamp.
 */

import {appendFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {homedir, platform} from 'node:os'
import {join} from 'node:path'

/** Current session's log file path (set on init) */
let sessionLogPath: string | undefined

/**
 * Returns the BRV home directory path following platform conventions:
 * - macOS/Linux: ~/.brv
 * - Windows: %LOCALAPPDATA%/brv (falls back to %USERPROFILE%/.brv)
 */
function getBrvHomeDir(): string {
  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData !== undefined) {
      return join(localAppData, 'brv')
    }

    const appData = process.env.APPDATA
    if (appData !== undefined) {
      return join(appData, 'brv')
    }

    return join(homedir(), '.brv')
  }

  return join(homedir(), '.brv')
}

/**
 * Get the logs directory path.
 */
function getLogsDir(): string {
  return join(getBrvHomeDir(), 'logs')
}

/**
 * Ensure logs directory exists.
 */
function ensureLogDir(): void {
  const logsDir = getLogsDir()
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, {recursive: true})
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
      ensureLogDir()
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
 *
 * @returns The path to the log file (for user feedback)
 */
export function crashLog(error: Error | string, contextStr = 'Unknown'): string {
  const errorMessage = error instanceof Error ? error.message : error
  const errorStack = error instanceof Error ? error.stack : undefined
  const timestamp = formatTimestamp()
  const logPath = getLogPath()

  try {
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
    // If we can't write, at least try to return something useful
  }

  return logPath
}

/**
 * Get the path to the current session's log file.
 */
export function getSessionLogPath(): string {
  return getLogPath()
}
