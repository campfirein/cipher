/**
 * SessionMetadataStore - Manages session metadata persistence.
 *
 * Stores session metadata in .brv/sessions/ directory:
 * - active.json: Current active session pointer
 * - session-*.json: Individual session metadata files
 *
 * Design adapted from gemini-cli's ChatRecordingService pattern.
 */

import * as fs from 'node:fs/promises'
import {join} from 'node:path'

import type {ISessionPersistence, SessionCleanupResult, SessionRetentionConfig} from '../../../core/interfaces/cipher/i-session-persistence.js'

import {
  ACTIVE_SESSION_FILE,
  type ActiveSessionPointer,
  ActiveSessionPointerSchema,
  cleanMessageForTitle,
  generateSessionFilename,
  parseSessionFilename,
  SESSION_FILE_PREFIX,
  type SessionInfo,
  type SessionMetadata,
  SessionMetadataSchema,
  SESSIONS_DIR,
} from '../../../core/domain/cipher/session/session-metadata.js'

/**
 * Check if a process with given PID is running.
 *
 * @param pid - Process ID to check
 * @returns True if process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without actually sending a signal
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * SessionMetadataStore implementation.
 *
 * Manages session metadata stored in .brv/sessions/ directory.
 */
export class SessionMetadataStore implements ISessionPersistence {
  private readonly activeSessionPath: string
  private readonly sessionsDir: string
  private readonly workingDirectory: string

  /**
   * Create a new SessionMetadataStore.
   *
   * @param workingDirectory - Project working directory (defaults to process.cwd())
   */
  constructor(workingDirectory?: string) {
    this.workingDirectory = workingDirectory ?? process.cwd()
    this.sessionsDir = join(this.workingDirectory, '.brv', SESSIONS_DIR)
    this.activeSessionPath = join(this.sessionsDir, ACTIVE_SESSION_FILE)
  }

  // ============================================================================
  // Active Session Management
  // ============================================================================

  async cleanupSessions(config: SessionRetentionConfig): Promise<SessionCleanupResult> {
    const result: SessionCleanupResult = {
      corruptedRemoved: 0,
      deletedByAge: 0,
      deletedByCount: 0,
      remaining: 0,
    }

    try {
      const files = await fs.readdir(this.sessionsDir)
      const sessionFiles = files.filter(
        (f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'),
      )

      const active = await this.getActiveSession()
      const validSessions: {file: string; metadata: SessionMetadata}[] = []

      // First pass: identify corrupted files and valid sessions
      for (const file of sessionFiles) {
        const filePath = join(this.sessionsDir, file)

        try {
          // eslint-disable-next-line no-await-in-loop
          const content = await fs.readFile(filePath, 'utf8')
          const data = JSON.parse(content)
          const parseResult = SessionMetadataSchema.safeParse(data)

          if (!parseResult.success) {
            // Corrupted file - delete it
            // eslint-disable-next-line no-await-in-loop
            await fs.unlink(filePath)
            result.corruptedRemoved++
            continue
          }

          validSessions.push({file, metadata: parseResult.data as SessionMetadata})
        } catch {
          // Can't read/parse - delete it
          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.unlink(filePath)
            result.corruptedRemoved++
          } catch {
            // Ignore delete errors
          }
        }
      }

      // Sort by lastUpdated (newest first)
      validSessions.sort(
        (a, b) => new Date(b.metadata.lastUpdated).getTime() - new Date(a.metadata.lastUpdated).getTime(),
      )

      const now = Date.now()
      const maxAgeMs = config.maxAgeDays * 24 * 60 * 60 * 1000

      // Second pass: apply retention policies
      for (const [i, {file, metadata}] of validSessions.entries()) {
        // Never delete the current active session
        if (active && metadata.sessionId === active.sessionId) {
          continue
        }

        const age = now - new Date(metadata.lastUpdated).getTime()
        const shouldDeleteByAge = age > maxAgeMs
        const shouldDeleteByCount = i >= config.maxCount
        const shouldDelete = shouldDeleteByAge || shouldDeleteByCount

        if (!shouldDelete) {
          continue
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.unlink(join(this.sessionsDir, file))

          if (shouldDeleteByAge) {
            result.deletedByAge++
          } else {
            result.deletedByCount++
          }
        } catch {
          // Ignore delete errors
        }
      }

      // Count remaining
      const remainingFiles = await fs.readdir(this.sessionsDir)
      result.remaining = remainingFiles.filter(
        (f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'),
      ).length

      return result
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return result
      }

      throw error
    }
  }

  async clearActiveSession(): Promise<void> {
    try {
      await fs.unlink(this.activeSessionPath)
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  /**
   * Create a new session metadata object.
   *
   * @param sessionId - Session ID
   * @returns New session metadata with defaults
   */
  createSessionMetadata(sessionId: string): SessionMetadata {
    const now = new Date().toISOString()

    return {
      createdAt: now,
      lastUpdated: now,
      messageCount: 0,
      sessionId,
      status: 'active',
      workingDirectory: this.workingDirectory,
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const files = await fs.readdir(this.sessionsDir)

      for (const file of files) {
        if (!file.startsWith(SESSION_FILE_PREFIX) || !file.endsWith('.json')) {
          continue
        }

        const parsed = parseSessionFilename(file)
        if (parsed && sessionId.startsWith(parsed.uuidPrefix)) {
          // eslint-disable-next-line no-await-in-loop
          await fs.unlink(join(this.sessionsDir, file))
          return true
        }

        // Also check by reading the file to match full sessionId
        try {
          const filePath = join(this.sessionsDir, file)
          // eslint-disable-next-line no-await-in-loop
          const content = await fs.readFile(filePath, 'utf8')
          const data = JSON.parse(content)

          if (data.sessionId === sessionId) {
            // eslint-disable-next-line no-await-in-loop
            await fs.unlink(filePath)
            return true
          }
        } catch {
          // Continue to next file
        }
      }

      return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }

      throw error
    }
  }

  async getActiveSession(): Promise<ActiveSessionPointer | null> {
    try {
      const content = await fs.readFile(this.activeSessionPath, 'utf8')
      const data = JSON.parse(content)
      const result = ActiveSessionPointerSchema.safeParse(data)

      if (!result.success) {
        // Invalid format - treat as no active session
        return null
      }

      return result.data
    } catch (error) {
      // File doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      throw error
    }
  }

  async getSession(sessionId: string): Promise<null | SessionMetadata> {
    const sessions = await this.listSessions()
    return sessions.find((s) => s.sessionId === sessionId) ?? null
  }

  async isActiveSessionStale(): Promise<boolean> {
    const active = await this.getActiveSession()

    if (!active) {
      return false
    }

    return !isProcessRunning(active.pid)
  }

  async isSessionForCurrentProject(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId)

    if (!session) {
      return false
    }

    return session.workingDirectory === this.workingDirectory
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      await this.ensureSessionsDir()
      const files = await fs.readdir(this.sessionsDir)

      const sessionFiles = files.filter(
        (f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith('.json'),
      )

      const active = await this.getActiveSession()
      const sessions: SessionInfo[] = []

      for (const file of sessionFiles) {
        try {
          const filePath = join(this.sessionsDir, file)
          // eslint-disable-next-line no-await-in-loop
          const content = await fs.readFile(filePath, 'utf8')
          const data = JSON.parse(content)
          const result = SessionMetadataSchema.safeParse(data)

          if (!result.success) {
            // Skip corrupted files
            continue
          }

          const metadata = result.data as SessionMetadata
          const isCurrentSession = active?.sessionId === metadata.sessionId

          sessions.push({
            ...metadata,
            file: file.replace('.json', ''),
            fileName: file,
            firstUserMessage: metadata.title,
            index: 0, // Will be set after sorting
            isCurrentSession,
          })
        } catch {
          // Skip files that can't be read or parsed
          continue
        }
      }

      // Sort by lastUpdated (newest first)
      sessions.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

      // Set 1-based indexes
      for (const [index, session] of sessions.entries()) {
        session.index = index + 1
      }

      return sessions
    } catch (error) {
      // Directory doesn't exist
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }

      throw error
    }
  }

  // ============================================================================
  // Session Lifecycle
  // ============================================================================

  async markSessionEnded(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)

    if (session) {
      session.status = 'ended'
      session.lastUpdated = new Date().toISOString()
      await this.saveSession(session)
    }
  }

  async markSessionInterrupted(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId)

    if (session) {
      session.status = 'interrupted'
      session.lastUpdated = new Date().toISOString()
      await this.saveSession(session)
    }
  }

  async saveSession(metadata: SessionMetadata): Promise<void> {
    await this.ensureSessionsDir()

    // Find existing file for this session or create new
    let filename: string

    try {
      const files = await fs.readdir(this.sessionsDir)
      const existingFile = files.find((f) => {
        if (!f.startsWith(SESSION_FILE_PREFIX) || !f.endsWith('.json')) {
          return false
        }

        const parsed = parseSessionFilename(f)
        return parsed && metadata.sessionId.startsWith(parsed.uuidPrefix)
      })

      filename = existingFile ?? generateSessionFilename(metadata.sessionId)
    } catch {
      filename = generateSessionFilename(metadata.sessionId)
    }

    const filePath = join(this.sessionsDir, filename)
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf8')
  }

  async setActiveSession(sessionId: string): Promise<void> {
    await this.ensureSessionsDir()

    const pointer: ActiveSessionPointer = {
      activatedAt: new Date().toISOString(),
      pid: process.pid,
      sessionId,
    }

    await fs.writeFile(this.activeSessionPath, JSON.stringify(pointer, null, 2), 'utf8')
  }

  async setSessionTitle(sessionId: string, title: string): Promise<void> {
    const session = await this.getSession(sessionId)

    if (session && !session.title) {
      session.title = cleanMessageForTitle(title)
      session.lastUpdated = new Date().toISOString()
      await this.saveSession(session)
    }
  }

  async updateSessionActivity(sessionId: string, messageCount: number): Promise<void> {
    const session = await this.getSession(sessionId)

    if (session) {
      session.lastUpdated = new Date().toISOString()
      session.messageCount = messageCount
      await this.saveSession(session)
    }
  }

  /**
   * Ensure the sessions directory exists.
   */
  private async ensureSessionsDir(): Promise<void> {
    await fs.mkdir(this.sessionsDir, {recursive: true})
  }
}
