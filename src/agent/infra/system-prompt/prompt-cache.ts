import fs from 'node:fs'

/**
 * Cache entry for a prompt configuration.
 */
export interface PromptCacheEntry<T> {
  /** Cached content */
  content: T
  /** Timestamp when this entry was loaded */
  loadedAt: number
  /** File modification time in milliseconds when cached */
  mtimeMs: number
}

/**
 * Options for configuring the prompt cache.
 */
export interface PromptCacheOptions {
  /** Maximum number of entries to store (default: 100) */
  maxSize?: number
  /** TTL in milliseconds, 0 means no TTL (default: 0) */
  ttlMs?: number
  /** Whether to validate file mtime on cache hit (default: true) */
  validateMtime?: boolean
}

/**
 * Prompt cache with file modification time and TTL validation.
 *
 * Features:
 * - Validates cached entries against file modification time
 * - Optional TTL-based expiration
 * - LRU-style eviction when max size is reached
 */
export class PromptCache<T> {
  private readonly cache = new Map<string, PromptCacheEntry<T>>()
  private readonly maxSize: number
  private readonly ttlMs: number
  private readonly validateMtime: boolean

  /**
   * Creates a new prompt cache.
   *
   * @param options - Cache configuration options
   */
  public constructor(options: PromptCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 100
    this.ttlMs = options.ttlMs ?? 0
    this.validateMtime = options.validateMtime ?? true
  }

  /**
   * Clear all cached entries.
   */
  public clear(): void {
    this.cache.clear()
  }

  /**
   * Get a cached entry if valid.
   *
   * Returns undefined if:
   * - Entry doesn't exist
   * - TTL has expired
   * - File has been modified (mtime validation enabled)
   *
   * @param filepath - Absolute path to the file
   * @returns Cached content or undefined if not valid
   */
  public get(filepath: string): T | undefined {
    const entry = this.cache.get(filepath)

    if (!entry) {
      return undefined
    }

    // Check TTL
    if (this.ttlMs > 0) {
      const age = Date.now() - entry.loadedAt

      if (age > this.ttlMs) {
        this.cache.delete(filepath)

        return undefined
      }
    }

    // Check file modification time
    if (this.validateMtime) {
      try {
        const stats = fs.statSync(filepath)

        if (stats.mtimeMs > entry.mtimeMs) {
          this.cache.delete(filepath)

          return undefined
        }
      } catch {
        // File doesn't exist or can't be accessed, invalidate cache
        this.cache.delete(filepath)

        return undefined
      }
    }

    return entry.content
  }

  /**
   * Get cache statistics.
   *
   * @returns Object with size and maxSize
   */
  public getStats(): {maxSize: number; size: number} {
    return {
      maxSize: this.maxSize,
      size: this.cache.size,
    }
  }

  /**
   * Check if an entry exists and is valid.
   *
   * @param filepath - Absolute path to the file
   * @returns True if a valid entry exists
   */
  public has(filepath: string): boolean {
    return this.get(filepath) !== undefined
  }

  /**
   * Invalidate a specific cache entry.
   *
   * @param filepath - Absolute path to the file
   * @returns True if an entry was removed
   */
  public invalidate(filepath: string): boolean {
    return this.cache.delete(filepath)
  }

  /**
   * Get all cached filepaths.
   *
   * @returns Array of cached filepaths
   */
  public keys(): string[] {
    return [...this.cache.keys()]
  }

  /**
   * Store content in the cache.
   *
   * If the cache is at max capacity, the oldest entry is evicted.
   *
   * @param filepath - Absolute path to the file
   * @param content - Content to cache
   */
  public set(filepath: string, content: T): void {
    // Evict oldest entry if at max size
    if (this.cache.size >= this.maxSize && !this.cache.has(filepath)) {
      const oldest = this.findOldestEntry()

      if (oldest) {
        this.cache.delete(oldest)
      }
    }

    // Get file mtime
    let mtimeMs = Date.now()

    try {
      const stats = fs.statSync(filepath)
      mtimeMs = stats.mtimeMs
    } catch {
      // Use current time if file doesn't exist
    }

    this.cache.set(filepath, {
      content,
      loadedAt: Date.now(),
      mtimeMs,
    })
  }

  /**
   * Find the oldest cache entry by loadedAt timestamp.
   *
   * @returns Filepath of the oldest entry, or undefined if cache is empty
   */
  private findOldestEntry(): string | undefined {
    let oldestPath: string | undefined
    let oldestTime = Number.POSITIVE_INFINITY

    for (const [filepath, entry] of this.cache.entries()) {
      if (entry.loadedAt < oldestTime) {
        oldestTime = entry.loadedAt
        oldestPath = filepath
      }
    }

    return oldestPath
  }
}
