/**
 * Hook Session Store
 *
 * Simple file-based store for sharing state between Claude Code hooks.
 * UserPromptSubmit saves session info, Stop hook reads it.
 *
 * Architecture: One file per session
 * Location: ~/.local/share/brv/hook-sessions/{sessionId}.json
 */

import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import type {HookSession} from './schemas.js'

import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {debugLog} from '../shared/debug-logger.js'
import {MAX_AGE_MS} from './constants.js'
import {HookSessionSchema} from './schemas.js'

/**
 * One-file-per-session store for Claude Code hooks.
 *
 * Architecture:
 * - Each session stored in separate file: ~/.local/share/brv/hook-sessions/{sessionId}.json
 * - No concurrency issues: UserPromptSubmit and Stop are sequential per session
 * - Cleanup: Delete files older than 24 hours by modification time
 */
export class HookSessionStore {
  private readonly sessionsDir: string

  constructor() {
    this.sessionsDir = join(getGlobalDataDir(), 'hook-sessions')
  }

  /**
   * Remove sessions older than maxAgeMs.
   * Uses file modification time for cleanup.
   *
   * @param maxAgeMs - Maximum session age in milliseconds (default: 24 hours)
   */
  async cleanup(maxAgeMs: number = MAX_AGE_MS): Promise<void> {
    try {
      if (!existsSync(this.sessionsDir)) {
        return
      }

      const now = Date.now()
      const files = readdirSync(this.sessionsDir)
      let removedCount = 0

      for (const file of files) {
        if (!file.endsWith('.json')) continue

        const filePath = join(this.sessionsDir, file)
        const stats = statSync(filePath)
        const age = now - stats.mtimeMs

        if (age > maxAgeMs) {
          unlinkSync(filePath)
          removedCount++
        }
      }

      if (removedCount > 0) {
        debugLog('SESSION', 'Cleaned up old sessions', {removedCount})
      }
    } catch (error) {
      debugLog('SESSION', 'Failed to cleanup sessions', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Read a session by ID.
   *
   * @param sessionId - Session ID to retrieve
   * @returns Session data or undefined if not found
   */
  async read(sessionId: string): Promise<HookSession | undefined> {
    try {
      const filePath = this.getSessionFilePath(sessionId)

      if (!existsSync(filePath)) {
        return undefined
      }

      const content = readFileSync(filePath, 'utf8')
      const result = HookSessionSchema.safeParse(JSON.parse(content))

      return result.success ? result.data : undefined
    } catch (error) {
      debugLog('SESSION', 'Failed to read session', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      })
      return undefined
    }
  }

  /**
   * Write a session.
   * Performs opportunistic cleanup ~10% of the time.
   *
   * @param session - Session data to store
   */
  async write(session: HookSession): Promise<void> {
    try {
      this.ensureSessionsDir()

      const filePath = this.getSessionFilePath(session.sessionId)
      writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8')

      // Opportunistic cleanup to prevent unbounded growth
      // Run AFTER write to avoid blocking
      if (Math.random() < 0.1) {
        // Fire and forget - don't block on cleanup
        this.cleanup().catch(() => {
          // Ignore cleanup errors
        })
      }
    } catch (error) {
      debugLog('SESSION', 'Failed to write session', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: session.sessionId,
      })
      // Silent fail - don't block hook execution
    }
  }

  /**
   * Ensure sessions directory exists.
   */
  private ensureSessionsDir(): void {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, {recursive: true})
    }
  }

  /**
   * Get file path for a session ID.
   * Sanitizes session ID to prevent path traversal.
   *
   * @param sessionId - Session ID
   * @returns Full path to session file
   */
  private getSessionFilePath(sessionId: string): string {
    // Sanitize session ID to prevent path traversal
    const sanitized = sessionId.replaceAll(/[^a-zA-Z0-9-_]/g, '-')
    return join(this.sessionsDir, `${sanitized}.json`)
  }
}
