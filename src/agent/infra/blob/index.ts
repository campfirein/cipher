/**
 * Blob storage module
 * Provides persistent storage for binary/large data blobs
 */

// Re-export types from core domain
export type {BlobMetadata, BlobStats, BlobStorageConfig, StoredBlob} from '../../core/domain/blob/types.js'

// Re-export errors from core
export {BlobError, BlobErrorCode} from '../../core/domain/errors/blob-error.js'

// Re-export interface from core
export type {IBlobStorage} from '../../core/interfaces/i-blob-storage.js'

// Factory (returns file-based implementation)
export {createBlobStorage} from './blob-storage-factory.js'

// File-based storage implementation
export {FileBlobStorage} from './file-blob-storage.js'
