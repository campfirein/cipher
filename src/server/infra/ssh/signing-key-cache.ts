import type {ParsedSSHKey} from './types.js'

interface CacheEntry {
  expiresAt: number
  key: ParsedSSHKey
}

/**
 * In-memory TTL cache for parsed SSH private keys.
 *
 * Option C Path B: after successful file-based parsing (with passphrase),
 * cache the ParsedSSHKey object (which holds an opaque crypto.KeyObject)
 * so subsequent commits within the TTL window require no passphrase prompt.
 *
 * Security properties:
 * - Stored in daemon process memory only — never written to disk
 * - crypto.KeyObject is opaque and not directly extractable
 * - Passphrase is never stored — only the decrypted key object
 * - Cleared entirely on daemon restart
 * - Per-key invalidation when user changes config
 */
export class SigningKeyCache {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly ttlMs: number

  /**
   * @param ttlMs - Cache TTL in milliseconds.
   *   Default: 30 minutes. Rationale: a user signing many commits in one session
   *   should not need to re-parse the key file on every commit. 30 minutes balances
   *   convenience against the window in which a compromised daemon process could use
   *   the cached key object. The passphrase itself is never stored — only the opaque
   *   crypto.KeyObject produced after decryption.
   */
  constructor(ttlMs: number = 30 * 60 * 1000) {
    this.ttlMs = ttlMs
  }

  /**
   * Current number of cached (non-expired) keys.
   */
  get size(): number {
    const now = Date.now()
    let count = 0
    for (const [, entry] of this.cache) {
      if (now <= entry.expiresAt) count++
    }

    return count
  }

  /**
   * Get a cached key by its resolved file path.
   * Returns null if the entry does not exist or has expired.
   */
  get(keyPath: string): null | ParsedSSHKey {
    const entry = this.cache.get(keyPath)
    if (!entry) return null

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(keyPath)
      return null
    }

    return entry.key
  }

  /**
   * Invalidate a specific key (e.g., when user changes signing key config).
   */
  invalidate(keyPath: string): void {
    this.cache.delete(keyPath)
  }

  /**
   * Clear all cached keys (e.g., on explicit logout or security reset).
   */
  invalidateAll(): void {
    this.cache.clear()
  }

  /**
   * Cache a parsed key by its resolved file path.
   * Resets TTL if the key was already cached.
   * Also sweeps expired entries to prevent memory leaks.
   */
  set(keyPath: string, key: ParsedSSHKey): void {
    const now = Date.now()

    // Sweep expired entries
    for (const [path, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(path)
    }

    this.cache.set(keyPath, {
      expiresAt: now + this.ttlMs,
      key,
    })
  }
}
