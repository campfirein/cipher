import type {BlobStorageConfig} from '../../../core/domain/cipher/blob/types.js'
import type {IBlobStorage} from '../../../core/interfaces/cipher/i-blob-storage.js'

import {SqliteBlobStorage} from './sqlite-blob-storage.js'

/**
 * Factory function to create blob storage backend.
 * Always uses SQLite for better performance, single file, and ACID transactions.
 *
 * @param config - Blob storage configuration
 * @returns SQLite blob storage implementation
 *
 * @example
 * const storage = createBlobStorage({ storageDir: '.brv/blobs' });
 */
export function createBlobStorage(config?: Partial<BlobStorageConfig>): IBlobStorage {
  return new SqliteBlobStorage(config)
}
