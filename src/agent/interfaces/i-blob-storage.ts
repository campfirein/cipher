import type {BlobMetadata, BlobStats, StoredBlob} from '../types/blob/types.js';

/**
 * Interface for blob storage operations
 * Provides persistent storage for binary/large data blobs
 */
export interface IBlobStorage {
  /**
   * Clear all blobs from storage
   * WARNING: This is a destructive operation
   *
   * @throws If clearing fails
   */
  clear(): Promise<void>;

  /**
   * Close the storage connection and release resources.
   * Should be called when storage is no longer needed.
   * Safe to call multiple times (idempotent).
   */
  close(): void;

  /**
   * Delete a blob by its key
   *
   * @param key - The blob identifier
   *
   * @throws If blob not found or deletion fails
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a blob exists
   *
   * @param key - The blob identifier
   * @returns True if the blob exists, false otherwise
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get metadata for a blob without retrieving its content
   *
   * @param key - The blob identifier
   * @returns The blob metadata, or undefined if not found
   *
   * @throws If retrieval fails
   */
  getMetadata(key: string): Promise<BlobMetadata | undefined>;

  /**
   * Get storage statistics
   *
   * @returns Statistics about the blob storage (count, total size, last updated)
   */
  getStats(): Promise<BlobStats>;

  /**
   * Initialize the storage system
   * Must be called before any other operations
   *
   * @throws If initialization fails
   */
  initialize(): Promise<void>;

  /**
   * List all blob keys, optionally filtered by prefix
   *
   * @param prefix - Optional prefix to filter keys
   * @returns Array of blob keys matching the prefix
   */
  list(prefix?: string): Promise<string[]>;

  /**
   * Retrieve a blob by its key
   *
   * @param key - The blob identifier
   * @returns The stored blob with content and metadata, or undefined if not found
   *
   * @throws If retrieval fails
   */
  retrieve(key: string): Promise<StoredBlob | undefined>;

  /**
   * Store a blob with optional metadata
   *
   * @param key - Unique identifier for the blob (alphanumeric, hyphens, underscores only)
   * @param content - Blob content as Buffer or string
   * @param metadata - Optional metadata (partial, defaults will be applied)
   * @returns The stored blob with complete metadata
   *
   * @throws If key is invalid, content is too large, or storage fails
   */
  store(
    key: string,
    content: Buffer | string,
    metadata?: Partial<BlobMetadata>,
  ): Promise<StoredBlob>;
}
