/**
 * Hook Session Store
 *
 * Simple file-based store for sharing state between Claude Code hooks.
 * UserPromptSubmit saves session info, Stop hook reads it.
 *
 * Architecture: One file per session
 * Location: ~/.local/share/brv/hook-sessions/{sessionId}.json
 */

import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, stat, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {IHookSessionStore} from '../../core/interfaces/hooks/i-hook-session-store.js'
import type {HookSession} from './schemas.js'

import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {debugLog, hookErrorLog} from '../shared/debug-logger.js'
import {MAX_AGE_MS} from './constants.js'
import {HookSessionSchema} from './schemas.js'

/** Re-export interface for convenience */
export type {IHookSessionStore} from '../../core/interfaces/hooks/i-hook-session-store.js'

/**
 * One-file-per-session store for Claude Code hooks.
 *
 * Architecture:
 * - Each session stored in separate file: ~/.local/share/brv/hook-sessions/{sessionId}.json
 * - No concurrency issues: UserPromptSubmit and Stop are sequential per session
 * - Cleanup: Delete files older than 24 hours by modification time
 */
export class HookSessionStore implements IHookSessionStore {
  private readonly sessionsDir: string

  /**
   * @param sessionsDir - Optional custom sessions directory (for testing).
   *                      Defaults to ~/.local/share/brv/hook-sessions/
   */
  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? join(getGlobalDataDir(), 'hook-sessions')
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
      const files = await readdir(this.sessionsDir)
      const jsonFiles = files.filter((file) => file.endsWith('.json'))

      /** Process all files in parallel to avoid no-await-in-loop */
      const results = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = join(this.sessionsDir, file)
          try {
            const stats = await stat(filePath)
            const age = now - stats.mtimeMs

            if (age > maxAgeMs) {
              await unlink(filePath)
              /** Successfully removed */
              return true
            }
          } catch {
            /** File may have been deleted by another process */
          }

          /** Not removed */
          return false
        }),
      )

      const removedCount = results.filter(Boolean).length
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

      const content = await readFile(filePath, 'utf8')
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
      await this.ensureSessionsDir()

      const filePath = this.getSessionFilePath(session.sessionId)
      await writeFile(filePath, JSON.stringify(session, null, 2), 'utf8')

      /** Opportunistic cleanup to prevent unbounded growth. Run AFTER write to avoid blocking. */
      if (Math.random() < 0.1) {
        /** Fire and forget - don't block on cleanup */
        this.cleanup().catch(() => {
          /** Ignore cleanup errors */
        })
      }
    } catch (error) {
      /** Use hookErrorLog (always-on) so users know when session persistence fails */
      hookErrorLog('SESSION', error instanceof Error ? error : new Error(String(error)), `write:${session.sessionId}`)
      /** Silent fail - don't block hook execution */
    }
  }

  /**
   * Ensure sessions directory exists.
   */
  private async ensureSessionsDir(): Promise<void> {
    if (!existsSync(this.sessionsDir)) {
      await mkdir(this.sessionsDir, {recursive: true})
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
    /** Sanitize session ID to prevent path traversal */
    const sanitized = sessionId.replaceAll(/[^a-zA-Z0-9-_]/g, '-')
    return join(this.sessionsDir, `${sanitized}.json`)
  }
}
