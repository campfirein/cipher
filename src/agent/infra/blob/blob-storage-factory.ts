import type {BlobStorageConfig} from '../../core/domain/blob/types.js'
import type {IBlobStorage} from '../../core/interfaces/i-blob-storage.js'

import {FileBlobStorage} from './file-blob-storage.js'

/**
 * Factory function to create blob storage backend.
 * Uses file-based storage with one directory per blob.
 *
 * @param config - Blob storage configuration
 * @returns File-based blob storage implementation
 *
 * @example
 * const storage = createBlobStorage({ storageDir: '/path/to/xdg/storage' });
 */
export function createBlobStorage(config?: Partial<BlobStorageConfig>): IBlobStorage {
  return new FileBlobStorage(config)
}
