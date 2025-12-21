import {mkdir, writeFile} from 'node:fs/promises'
import {homedir, platform} from 'node:os'
import {join} from 'node:path'

/**
 * Returns the BRV home directory path following platform conventions:
 * - macOS/Linux: ~/.brv
 * - Windows: %LOCALAPPDATA%/brv (falls back to %USERPROFILE%/.brv)
 *
 * Note: We use LOCALAPPDATA on Windows (not APPDATA) because logs and
 * user data don't need to roam across machines.
 */
export function getBrvHomeDir(): string {
  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    // Windows: prefer LOCALAPPDATA for local user data
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData !== undefined) {
      return join(localAppData, 'brv')
    }

    // Fallback to APPDATA if LOCALAPPDATA not set
    const appData = process.env.APPDATA
    if (appData !== undefined) {
      return join(appData, 'brv')
    }

    // Final fallback to home directory
    return join(homedir(), '.brv')
  }

  // macOS and Linux: use ~/.brv
  return join(homedir(), '.brv')
}

/**
 * Creates a crash log file with detailed error information.
 *
 * Logs are stored in ~/.brv/logs/crash-<timestamp>.log
 *
 * @param error - The error that occurred
 * @param context - Additional context about where the crash happened
 * @returns Path to the created log file
 */
export async function writeCrashLog(error: Error | string, context?: string): Promise<string> {
  const logsDir = join(getBrvHomeDir(), 'logs')

  // Ensure logs directory exists
  await mkdir(logsDir, {recursive: true})

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const filename = `crash-${timestamp}.log`
  const filepath = join(logsDir, filename)

  // Build log content
  const errorMessage = error instanceof Error ? error.message : error
  const errorStack = error instanceof Error ? error.stack : undefined

  const logContent = [
    '='.repeat(60),
    'BRV CRASH LOG',
    '='.repeat(60),
    '',
    `Timestamp: ${new Date().toISOString()}`,
    `Context: ${context ?? 'Unknown'}`,
    '',
    '-'.repeat(60),
    'ERROR',
    '-'.repeat(60),
    '',
    `Message: ${errorMessage}`,
    '',
    'Stack Trace:',
    errorStack ?? '(No stack trace available)',
    '',
    '-'.repeat(60),
    'ENVIRONMENT',
    '-'.repeat(60),
    '',
    `Node.js: ${process.version}`,
    `Platform: ${process.platform}`,
    `Arch: ${process.arch}`,
    `CWD: ${process.cwd()}`,
    `PID: ${process.pid}`,
    '',
    '-'.repeat(60),
    'MEMORY USAGE',
    '-'.repeat(60),
    '',
    JSON.stringify(process.memoryUsage(), null, 2),
    '',
    '='.repeat(60),
  ].join('\n')

  await writeFile(filepath, logContent, 'utf8')

  return filepath
}

/**
 * Returns the path to the logs directory.
 */
export function getLogsDir(): string {
  return join(getBrvHomeDir(), 'logs')
}
