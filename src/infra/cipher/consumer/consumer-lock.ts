import {getAgentStorage, getAgentStorageSync} from '../storage/agent-storage.js'

// Consumer is considered stale after 30 seconds without heartbeat
const STALE_TIMEOUT_MS = 30_000

/**
 * DB-based consumer lock utilities
 *
 * The actual locking is now handled by AgentStorage methods:
 * - acquireConsumerLock(consumerId)
 * - releaseConsumerLock(consumerId)
 * - hasActiveConsumer(timeoutMs)
 *
 * These utility functions provide a simple interface for checking consumer status.
 */

/**
 * Check if a consumer is currently running (has active heartbeat in DB)
 * Auto-detects .brv/blobs path from cwd
 */
export async function isConsumerRunning(): Promise<boolean> {
  try {
    const storage = await getAgentStorage()
    return storage.hasActiveConsumer(STALE_TIMEOUT_MS)
  } catch {
    // If we can't check, assume not running
    return false
  }
}

/**
 * Check if a consumer is currently running (sync version)
 * Assumes storage is already initialized
 */
export function isConsumerRunningSync(): boolean {
  try {
    const storage = getAgentStorageSync()
    return storage.hasActiveConsumer(STALE_TIMEOUT_MS)
  } catch {
    return false
  }
}
