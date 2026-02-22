import {appendFileSync} from 'node:fs'

/**
 * Creates a logger function that writes timestamped messages to a log file.
 *
 * @param logPath - Absolute path to the log file (from BRV_SESSION_LOG env var).
 *   If undefined/empty, returns a no-op so that logging never throws.
 * @param prefix - Label prepended to every message (e.g. "[agent-process:/path]").
 *
 * Write failures are swallowed — logging must never block or crash the agent.
 */
export function createAgentLogger(logPath: string | undefined, prefix: string): (message: string) => void {
  if (!logPath) return () => {}

  return (message: string): void => {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} ${prefix} ${message}\n`)
    } catch {
      // ignore — never block on logging
    }
  }
}
