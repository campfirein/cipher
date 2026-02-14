/**
 * Session Resolver — Determines which session to use when an agent starts.
 *
 * Resolution strategy:
 * 1. Read active session pointer from metadata store
 * 2. If active + stale (PID dead / processToken mismatch): mark interrupted, resume it
 * 3. If active + not stale (another live process): create new
 * 4. If no active or any error: create new (fail-safe)
 *
 * Every read is wrapped in try/catch — any error falls back to a new session
 * so the user is never blocked.
 */

import type {SessionMetadataStore} from '../../../agent/infra/session/session-metadata-store.js'

export type SessionResolution = {isResume: boolean; sessionId: string}

export async function resolveSessionId(
  metadataStore: SessionMetadataStore,
  newSessionId: string,
  log: (msg: string) => void,
): Promise<SessionResolution> {
  try {
    const active = await metadataStore.getActiveSession()

    if (!active) {
      return {isResume: false, sessionId: newSessionId}
    }

    // Active session exists — check if the owning process is still alive
    let isStale: boolean
    try {
      isStale = await metadataStore.isActiveSessionStale()
    } catch {
      // Can't determine staleness — safer to create new
      log('Could not check session staleness, creating new session')
      return {isResume: false, sessionId: newSessionId}
    }

    if (isStale) {
      // Previous process died — mark as interrupted and resume
      try {
        await metadataStore.markSessionInterrupted(active.sessionId)
      } catch {
        // Non-blocking: even if we can't mark it, we still resume
        log(`Could not mark session ${active.sessionId} as interrupted`)
      }

      log(`Resuming stale session: ${active.sessionId}`)
      return {isResume: true, sessionId: active.sessionId}
    }

    // Another live process owns this session — create new
    log(`Active session owned by another process (pid=${active.pid}), creating new`)
    return {isResume: false, sessionId: newSessionId}
  } catch (error) {
    // Top-level catch: any unexpected error falls back to new session
    log(`Session resolve error, creating new: ${error instanceof Error ? error.message : String(error)}`)
    return {isResume: false, sessionId: newSessionId}
  }
}
