import type { Memory } from '../../domain/cipher/memory/types.js';

/**
 * Interface for memory storage operations
 *
 * Provides abstraction for persisting and retrieving memories.
 * Implementations can use different storage backends (file system, database, etc.)
 */
export interface IMemoryStorage {
  /**
   * Clear all memories from storage
   */
  clear(): Promise<void>;

  /**
   * Delete a memory by ID
   * @param id - Memory ID to delete
   */
  delete(id: string): Promise<void>;

  /**
   * Get a memory by ID
   * @param id - Memory ID to retrieve
   * @returns Memory object if found, undefined otherwise
   */
  get(id: string): Promise<Memory | undefined>;

  /**
   * Initialize the storage (create directories, establish connections, etc.)
   */
  initialize(): Promise<void>;

  /**
   * List all memory IDs with the given prefix
   * @param prefix - Key prefix to filter by (e.g., 'cipher:memory:item:')
   * @returns Array of memory IDs
   */
  list(prefix: string): Promise<string[]>;

  /**
   * Load all memories from storage
   * @returns Array of all memory objects
   */
  loadAll(): Promise<Memory[]>;

  /**
   * Save a memory to storage
   * @param memory - Memory object to save
   */
  save(memory: Memory): Promise<void>;
}
