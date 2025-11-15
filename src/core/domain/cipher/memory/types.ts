/**
 * Core memory types and interfaces for the cipher agent
 */

/**
 * Supported memory sources
 */
export type MemorySource = 'agent' | 'system' | 'user';

/**
 * Blob attachment metadata for a memory
 * References a blob stored in BlobStorage
 */
export interface Attachment {
  /** Reference key to the blob in BlobStorage */
  blobKey: string;
  /** Timestamp when the attachment was added (Unix timestamp in milliseconds) */
  createdAt: number;
  /** Original filename (if applicable) */
  name?: string;
  /** Size of the attachment in bytes */
  size: number;
  /** MIME type of the attachment */
  type: string;
}

/**
 * Memory item stored in the cipher agent system
 */
export interface Memory {
  /** The actual memory content */
  content: string;
  /** When the memory was created (Unix timestamp in milliseconds) */
  createdAt: number;
  /** Unique identifier for the memory */
  id: string;
  /** Additional metadata */
  metadata?:
    | undefined
    | {
        /** Any additional custom metadata */
        [key: string]: unknown;
        /** Whether this memory is pinned (for future hybrid approach) */
        pinned?: boolean | undefined;
        /** Source of the memory */
        source?: MemorySource | undefined;
      };
  /** Optional tags for categorization */
  tags?: string[] | undefined;
  /** When the memory was last updated (Unix timestamp in milliseconds) */
  updatedAt: number;
}

/**
 * Input for creating a new memory
 */
export interface CreateMemoryInput {
  /** The memory content */
  content: string;
  /** Optional metadata */
  metadata?: {
    [key: string]: unknown;
    source?: MemorySource;
  };
  /** Optional tags */
  tags?: string[];
}

/**
 * Input for updating an existing memory
 */
export interface UpdateMemoryInput {
  /** Updated content (optional) */
  content?: string;
  /** Updated metadata (optional, merges with existing) */
  metadata?: {
    [key: string]: unknown;
    pinned?: boolean;
    source?: MemorySource;
  };
  /** Updated tags (optional, replaces existing) */
  tags?: string[];
}

/**
 * Options for listing memories
 */
export interface ListMemoriesOptions {
  /** Limit number of results */
  limit?: number;
  /** Skip first N results */
  offset?: number;
  /** Filter by pinned status */
  pinned?: boolean;
  /** Filter by source */
  source?: MemorySource;
  /** Filter by tags (OR logic - matches any of the provided tags) */
  tags?: string[];
}

/**
 * Configuration for the cipher agent memory service
 */
export interface MemoryConfig {
  /** Default tags to apply to all memories created by the agent */
  defaultTags?: string[];
  /** Maximum number of memories to keep (optional limit) */
  maxMemories?: number;
  /** Directory where memories are stored (default: .byterover/cipher/memories) */
  storageDir?: string;
}
