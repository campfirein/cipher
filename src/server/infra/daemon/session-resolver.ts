/**
 * Session Resolver — Determines which session to use when an agent starts.
 *
 * Resolution strategy:
 * 1. Read active session pointer from metadata store
 * 2. If active + stale (PID dead / processToken mismatch):
 *    a. Mark interrupted (best-effort, always)
 *    b. Check provider compatibility — skip resume if provider changed
 *    c. Resume it
 * 3. If active + not stale (another live process): create new
 * 4. If no active or any error: create new (fail-safe)
 *
 * Every read is wrapped in try/catch — any error falls back to a new session
 * so the user is never blocked.
 */

import type {SessionMetadataStore} from '../../../agent/infra/session/session-metadata-store.js'

export type SessionResolution = {isResume: boolean; sessionId: string}

export async function resolveSessionId(options: {
  currentProviderId?: string
  log: (msg: string) => void
  metadataStore: SessionMetadataStore
  newSessionId: string
}): Promise<SessionResolution> {
  const {currentProviderId, log, metadataStore, newSessionId} = options
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
      // Always mark stale session as interrupted (best-effort, regardless of resume decision)
      try {
        await metadataStore.markSessionInterrupted(active.sessionId)
      } catch {
        log(`Could not mark session ${active.sessionId} as interrupted`)
      }

      // Check provider compatibility before resuming
      if (currentProviderId) {
        const skip = await shouldSkipResumeForProviderChange({
          currentProviderId,
          log,
          metadataStore,
          sessionId: active.sessionId,
        })
        if (skip) return {isResume: false, sessionId: newSessionId}
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

/**
 * Check if a stale session's provider is compatible with the current provider.
 * Returns true if resume should be skipped (provider mismatch or read error).
 * Pure check — does NOT modify session state (caller handles markSessionInterrupted).
 *
 * Loading history from a different provider causes tool_use_id format mismatches
 * (e.g., ByteRover IDs sent to Anthropic API).
 */
async function shouldSkipResumeForProviderChange(options: {
  currentProviderId: string
  log: (msg: string) => void
  metadataStore: SessionMetadataStore
  sessionId: string
}): Promise<boolean> {
  const {currentProviderId, log, metadataStore, sessionId} = options
  try {
    const metadata = await metadataStore.getSession(sessionId)
    if (metadata?.providerId && metadata.providerId !== currentProviderId) {
      log(
        `Provider mismatch: session used '${metadata.providerId}', ` +
          `current is '${currentProviderId}', creating new session`,
      )
      return true
    }

    return false
  } catch {
    log('Could not read session metadata for provider check, creating new session')
    return true
  }
}
