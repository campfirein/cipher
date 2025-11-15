/**
 * Blob storage module
 * Provides persistent storage for binary/large data blobs
 */

// Re-export types from core domain
export type {
  BlobMetadata,
  BlobStats,
  BlobStorageConfig,
  StoredBlob,
} from '../../../core/domain/cipher/blob/types.js';

// Re-export errors from core
export {BlobError, BlobErrorCode} from '../../../core/domain/cipher/errors/blob-error.js';

// Re-export interface from core
export type {IBlobStorage} from '../../../core/interfaces/cipher/i-blob-storage.js';

export {FileBlobStorage} from './file-blob-storage.js';
