import { createHash } from 'node:crypto'

/**
 * Cached query result entry.
 */
export interface QueryCacheEntry {
  /** Cached response content */
  content: string
  /** Context tree fingerprint at cache time */
  fingerprint: string
  /** Timestamp when cached */
  storedAt: number
}

/**
 * Configuration for QueryResultCache.
 */
export interface QueryResultCacheOptions {
  /** Maximum number of entries (default: 50) */
  maxSize?: number
  /** TTL in milliseconds (default: 60000) */
  ttlMs?: number
}

/**
 * In-memory LRU cache for query results with TTL and context tree fingerprint validation.
 *
 * Follows the same pattern as PromptCache (src/agent/infra/system-prompt/prompt-cache.ts):
 * - Map-based storage with configurable max size
 * - LRU eviction when at capacity
 * - TTL-based expiration
 * - Fingerprint-based invalidation when the context tree changes
 */
export class QueryResultCache {
  private readonly cache = new Map<string, QueryCacheEntry>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(options: QueryResultCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 50
    this.ttlMs = options.ttlMs ?? 60_000
  }

  /**
   * Compute a context tree fingerprint from file mtimes.
   * Uses sorted paths + mtimes to create a deterministic hash.
   * If any file changes (added, removed, modified), the fingerprint changes.
   *
   * @param files - Array of file paths with modification times
   * @returns 16-character hex fingerprint
   */
  static computeFingerprint(files: Array<{ mtime: number; path: string }>): string {
    if (files.length === 0) return 'empty'

    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
    const data = sorted.map((f) => `${f.path}:${f.mtime}`).join('|')
    return createHash('md5').update(data).digest('hex').slice(0, 16)
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get a cached result if valid.
   * Returns undefined if entry doesn't exist, TTL expired, or fingerprint mismatch.
   *
   * @param query - User query string
   * @param currentFingerprint - Current context tree fingerprint
   * @returns Cached response content or undefined
   */
  get(query: string, currentFingerprint: string): string | undefined {
    const key = this.normalizeQuery(query)
    const entry = this.cache.get(key)

    if (!entry) return undefined

    // Check TTL
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }

    // Check fingerprint (context tree changed?)
    if (entry.fingerprint !== currentFingerprint) {
      this.cache.delete(key)
      return undefined
    }

    return entry.content
  }

  /** Get cache statistics. */
  getStats(): { maxSize: number; size: number } {
    return {
      maxSize: this.maxSize,
      size: this.cache.size,
    }
  }

  /**
   * Store a result in the cache.
   *
   * @param query - User query string
   * @param content - Response content to cache
   * @param fingerprint - Context tree fingerprint at cache time
   */
  set(query: string, content: string, fingerprint: string): void {
    const key = this.normalizeQuery(query)

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) this.cache.delete(oldestKey)
    }

    this.cache.set(key, {
      content,
      fingerprint,
      storedAt: Date.now(),
    })
  }

  /** Normalize query for cache key consistency. */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replaceAll(/\s+/g, ' ')
  }
}
