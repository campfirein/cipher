/**
 * Crash Log - Re-exports from unified process-logger.
 *
 * @deprecated Use crashLog from process-logger.ts directly.
 * This file is kept for backwards compatibility.
 */

import {crashLog, getSessionLogPath} from './process-logger.js'

/**
 * @deprecated Use crashLog from process-logger.ts
 */
export async function writeCrashLog(error: Error | string, context?: string): Promise<string> {
  return crashLog(error, context)
}

/**
 * @deprecated Use getSessionLogPath from process-logger.ts
 */
export function getLogsDir(): string {
  return getSessionLogPath()
}
