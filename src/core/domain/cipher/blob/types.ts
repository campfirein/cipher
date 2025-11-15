/**
 * Blob metadata interface
 * Contains information about a stored blob
 */
export interface BlobMetadata {
  /**
   * MIME type of the blob content
   * @example 'image/png', 'application/pdf', 'text/plain'
   */
  contentType?: string;

  /**
   * Timestamp when the blob was created (Unix timestamp in milliseconds)
   */
  createdAt: number;

  /**
   * Original filename if the blob was created from a file
   * @example 'screenshot.png', 'document.pdf'
   */
  originalName?: string;

  /**
   * Size of the blob in bytes
   */
  size: number;

  /**
   * Custom metadata tags for categorization and filtering
   * @example { category: 'screenshot', project: 'myapp' }
   */
  tags?: Record<string, string>;

  /**
   * Timestamp when the blob was last updated (Unix timestamp in milliseconds)
   */
  updatedAt: number;
}

/**
 * Stored blob with content and metadata
 * Represents a complete blob retrieved from storage
 */
export interface StoredBlob {
  /**
   * Binary content of the blob
   */
  content: Buffer;

  /**
   * Unique identifier for the blob
   * Must be alphanumeric with hyphens and underscores only
   */
  key: string;

  /**
   * Associated metadata
   */
  metadata: BlobMetadata;
}

/**
 * Configuration options for blob storage
 */
export interface BlobStorageConfig {
  /**
   * Maximum size for a single blob in bytes
   * @default 104857600 (100MB)
   */
  maxBlobSize?: number;

  /**
   * Maximum total size for all blobs in bytes
   * @default 1073741824 (1GB)
   */
  maxTotalSize?: number;

  /**
   * Base directory where blobs will be stored
   * @default '.brv/blobs'
   */
  storageDir?: string;
}

/**
 * Statistics about blob storage
 */
export interface BlobStats {
  /**
   * Timestamp when stats were last calculated (Unix timestamp in milliseconds)
   */
  lastUpdated: number;

  /**
   * Total number of blobs stored
   */
  totalBlobs: number;

  /**
   * Total size of all blobs in bytes
   */
  totalSize: number;
}
