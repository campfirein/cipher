/**
 * Storage key as a tuple of string segments.
 * Examples:
 *   ["message", sessionId, messageId]
 *   ["part", messageId, partId]
 *   ["session", sessionId]
 */
export type StorageKey = readonly string[]

/**
 * Batch operation for atomic multi-key updates.
 */
export type BatchOperation =
  | {key: StorageKey; type: 'delete'}
  | {key: StorageKey; type: 'set'; value: unknown}

/**
 * Low-level key-value storage interface for granular persistence.
 *
 * Enables hierarchical data organization with prefix-based operations.
 * Designed to support the OpenCode-style message/part storage pattern
 * where messages and parts are stored at separate keys for selective loading.
 *
 * Key path structure:
 * - ["session", sessionId] → Session metadata
 * - ["message", sessionId, messageId] → Individual message
 * - ["part", messageId, partId] → Message part (tool output, file, etc.)
 */
export interface IKeyStorage {
  /**
   * Batch operations for atomic multi-key updates.
   * All operations succeed or fail together.
   *
   * @param operations - Array of set/delete operations
   */
  batch(operations: BatchOperation[]): Promise<void>

  /**
   * Delete a value by its composite key.
   *
   * @param key - Composite key as string segments
   * @returns True if the key existed and was deleted, false if not found
   */
  delete(key: StorageKey): Promise<boolean>

  /**
   * Check if a key exists.
   *
   * @param key - Composite key as string segments
   * @returns True if the key exists
   */
  exists(key: StorageKey): Promise<boolean>

  /**
   * Get a value by its composite key.
   *
   * @param key - Composite key as string segments
   * @returns The stored value, or undefined if not found
   */
  get<T>(key: StorageKey): Promise<T | undefined>

  /**
   * Initialize the storage backend.
   * Should be called once before any other operations.
   */
  initialize(): Promise<void>

  /**
   * List all keys matching a prefix.
   * Used for iterating over messages in a session or parts of a message.
   *
   * @param prefix - Key prefix to match (e.g., ["message", sessionId])
   * @returns Array of matching full keys
   */
  list(prefix: StorageKey): Promise<StorageKey[]>

  /**
   * Set a value at a composite key.
   * Creates or overwrites the value at the key.
   *
   * @param key - Composite key as string segments
   * @param value - Value to store (will be JSON serialized)
   */
  set<T>(key: StorageKey, value: T): Promise<void>

  /**
   * Atomic update with optimistic locking.
   * Reads the current value, applies the updater function, and writes back.
   *
   * @param key - Key to update
   * @param updater - Function that receives current value and returns new value
   * @returns The new value after update
   */
  update<T>(key: StorageKey, updater: (current: T | undefined) => T): Promise<T>
}
