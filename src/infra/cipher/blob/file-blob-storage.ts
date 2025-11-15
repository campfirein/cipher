import {existsSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';

import type {
  BlobMetadata,
  BlobStats,
  BlobStorageConfig,
  StoredBlob,
} from '../../../core/domain/cipher/blob/types.js';
import type {IBlobStorage} from '../../../core/interfaces/cipher/i-blob-storage.js';

import {BlobError} from '../../../core/domain/cipher/errors/blob-error.js';

/**
 * File-based blob storage implementation
 *
 * Stores each blob as two files:
 * - {key}.blob: Binary content
 * - {key}.meta.json: Metadata
 *
 * Default location: .brv/blobs/
 */
export class FileBlobStorage implements IBlobStorage {
  private initialized = false;
  private readonly maxBlobSize: number;
  private readonly maxTotalSize: number;
  private readonly STATS_CACHE_TTL = 60_000; // 60 seconds
// Stats cache to avoid expensive filesystem scans
  private statsCache: BlobStats | null = null;
  private statsCacheExpiry = 0;
  private readonly storageDir: string;

  constructor(config?: Partial<BlobStorageConfig>) {
    this.storageDir = config?.storageDir || join(process.cwd(), '.brv', 'blobs');
    this.maxBlobSize = config?.maxBlobSize ?? 100 * 1024 * 1024; // 100MB default
    this.maxTotalSize = config?.maxTotalSize ?? 1024 * 1024 * 1024; // 1GB default
  }

  /**
   * Clear all blobs from storage
   * WARNING: This is a destructive operation
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    try {
      const files = await fs.readdir(this.storageDir);
      const blobFiles = files.filter(
        (file) => file.endsWith('.blob') || file.endsWith('.meta.json'),
      );

      await Promise.all(
        blobFiles.map((file) =>
          fs.unlink(join(this.storageDir, file)).catch((error) => {
            console.warn(`Failed to delete ${file}: ${error.message}`);
          }),
        ),
      );

      // Reset stats cache
      this.statsCache = {
        lastUpdated: Date.now(),
        totalBlobs: 0,
        totalSize: 0,
      };
      this.statsCacheExpiry = Date.now() + this.STATS_CACHE_TTL;

      // Removed verbose console.log for cleaner interactive UX
      // console.log(`Cleared ${blobFiles.length / 2} blobs from storage`);
    } catch (error) {
      throw BlobError.deleteError(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Delete a blob by removing both files
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized();
    this.validateKey(key);

    const blobPath = this.getBlobPath(key);
    const metadataPath = this.getMetadataPath(key);

    try {
      // Get metadata to update stats before deleting
      const metadata = await this.getMetadata(key);
      if (!metadata) {
        throw BlobError.notFound(key);
      }

      // Delete both files
      await Promise.all([fs.unlink(blobPath), fs.unlink(metadataPath)]);

      // Update stats cache
      this.updateStatsCacheAfterDelete(metadata.size);

      // Removed verbose console.log for cleaner interactive UX
      // console.log(`Deleted blob: ${key}`);
    } catch (error) {
      if (error instanceof BlobError) {
        throw error;
      }

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw BlobError.notFound(key);
      }

      throw BlobError.deleteError(
        `Failed to delete blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Check if a blob exists
   */
  async exists(key: string): Promise<boolean> {
    this.ensureInitialized();
    this.validateKey(key);

    const blobPath = this.getBlobPath(key);

    try {
      await fs.access(blobPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get metadata for a blob without retrieving its content
   */
  async getMetadata(key: string): Promise<BlobMetadata | undefined> {
    this.ensureInitialized();
    this.validateKey(key);

    const metadataPath = this.getMetadataPath(key);

    try {
      const metadataJson = await fs.readFile(metadataPath, 'utf8');
      return JSON.parse(metadataJson) as BlobMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      throw BlobError.retrievalError(
        `Failed to read metadata for blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Get storage statistics
   * Uses caching to avoid expensive filesystem scans
   */
  async getStats(): Promise<BlobStats> {
    this.ensureInitialized();

    // Return cached stats if still valid
    const now = Date.now();
    if (this.statsCache && now < this.statsCacheExpiry) {
      return this.statsCache;
    }

    // Calculate stats from filesystem
    try {
      const files = await fs.readdir(this.storageDir);
      const metaFiles = files.filter((file) => file.endsWith('.meta.json'));

      let totalSize = 0;

      await Promise.all(
        metaFiles.map(async (file) => {
          try {
            const metadataPath = join(this.storageDir, file);
            const metadataJson = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataJson) as BlobMetadata;
            totalSize += metadata.size;
          } catch (error) {
            console.warn(
              `Failed to read metadata ${file}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );

      const stats: BlobStats = {
        lastUpdated: now,
        totalBlobs: metaFiles.length,
        totalSize,
      };

      // Cache the stats
      this.statsCache = stats;
      this.statsCacheExpiry = now + this.STATS_CACHE_TTL;

      return stats;
    } catch (error) {
      throw BlobError.retrievalError(
        `Failed to get storage stats: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Initialize storage by creating the directory if it doesn't exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await fs.mkdir(this.storageDir, {recursive: true});
      this.initialized = true;
      // Removed verbose console.log for cleaner interactive UX
      // console.log(`Blob storage initialized at: ${this.storageDir}`);
    } catch (error) {
      throw BlobError.initializationError(
        `Failed to initialize storage directory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * List all blob keys, optionally filtered by prefix
   */
  async list(prefix?: string): Promise<string[]> {
    this.ensureInitialized();

    try {
      const files = await fs.readdir(this.storageDir);
      const blobFiles = files.filter((file) => file.endsWith('.blob'));

      // Extract keys from filenames (remove .blob extension)
      let keys = blobFiles.map((file) => file.slice(0, -5));

      // Filter by prefix if provided
      if (prefix) {
        keys = keys.filter((key) => key.startsWith(prefix));
      }

      return keys;
    } catch (error) {
      throw BlobError.retrievalError(
        `Failed to list blobs: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Retrieve a blob by its key
   */
  async retrieve(key: string): Promise<StoredBlob | undefined> {
    this.ensureInitialized();
    this.validateKey(key);

    const blobPath = this.getBlobPath(key);
    const metadataPath = this.getMetadataPath(key);

    try {
      const [content, metadataJson] = await Promise.all([
        fs.readFile(blobPath),
        fs.readFile(metadataPath, 'utf8'),
      ]);

      const metadata = JSON.parse(metadataJson) as BlobMetadata;

      return {
        content,
        key,
        metadata,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      throw BlobError.retrievalError(
        `Failed to retrieve blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Store a blob with optional metadata
   * Uses atomic write pattern (temp file + rename)
   */
  async store(
    key: string,
    content: Buffer | string,
    metadata?: Partial<BlobMetadata>,
  ): Promise<StoredBlob> {
    this.ensureInitialized();
    this.validateKey(key);

    // Convert content to Buffer
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

    // Check individual blob size
    if (buffer.length > this.maxBlobSize) {
      throw BlobError.tooLarge(buffer.length, this.maxBlobSize);
    }

    // Check total storage size
    const stats = await this.getStats();
    if (stats.totalSize + buffer.length > this.maxTotalSize) {
      throw BlobError.totalSizeExceeded(
        stats.totalSize,
        buffer.length,
        this.maxTotalSize,
      );
    }

    const now = Date.now();
    const fullMetadata: BlobMetadata = {
      createdAt: now,
      size: buffer.length,
      updatedAt: now,
      ...metadata,
    };

    const blobPath = this.getBlobPath(key);
    const metadataPath = this.getMetadataPath(key);
    const tempBlobPath = `${blobPath}.tmp`;
    const tempMetadataPath = `${metadataPath}.tmp`;

    try {
      // Write to temporary files first
      await Promise.all([
        fs.writeFile(tempBlobPath, buffer),
        fs.writeFile(
          tempMetadataPath,
          JSON.stringify(fullMetadata, null, 2),
          'utf8',
        ),
      ]);

      // Atomic renames
      await Promise.all([
        fs.rename(tempBlobPath, blobPath),
        fs.rename(tempMetadataPath, metadataPath),
      ]);

      // Update stats cache
      this.updateStatsCacheAfterStore(buffer.length);

      // Removed verbose console.log for cleaner interactive UX
      // console.log(`Stored blob: ${key} (${buffer.length} bytes)`);

      return {
        content: buffer,
        key,
        metadata: fullMetadata,
      };
    } catch (error) {
      // Cleanup temp files
      await this.cleanup(tempBlobPath, tempMetadataPath);

      throw BlobError.storageError(
        `Failed to store blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Clean up temporary files
   */
  private async cleanup(...paths: string[]): Promise<void> {
    await Promise.all(
      paths.map((path) =>
        existsSync(path) ? fs.unlink(path).catch(() => {}) : Promise.resolve(),
      ),
    );
  }

  /**
   * Ensure storage has been initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw BlobError.notInitialized();
    }
  }

  /**
   * Get the file path for blob content
   */
  private getBlobPath(key: string): string {
    return join(this.storageDir, `${key}.blob`);
  }

  /**
   * Get the file path for blob metadata
   */
  private getMetadataPath(key: string): string {
    return join(this.storageDir, `${key}.meta.json`);
  }

  /**
   * Update stats cache after deleting a blob
   */
  private updateStatsCacheAfterDelete(size: number): void {
    if (this.statsCache && Date.now() < this.statsCacheExpiry) {
      this.statsCache.totalBlobs -= 1;
      this.statsCache.totalSize -= size;
      this.statsCache.lastUpdated = Date.now();
    }
  }

  /**
   * Update stats cache after storing a blob
   */
  private updateStatsCacheAfterStore(size: number): void {
    if (this.statsCache && Date.now() < this.statsCacheExpiry) {
      this.statsCache.totalBlobs += 1;
      this.statsCache.totalSize += size;
      this.statsCache.lastUpdated = Date.now();
    }
  }

  /**
   * Validate blob key
   * Keys must be alphanumeric with hyphens and underscores only
   */
  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw BlobError.invalidKey(String(key), 'Key must be a non-empty string');
    }

    if (key.length === 0) {
      throw BlobError.invalidKey(key, 'Key cannot be empty');
    }

    // Allow alphanumeric, hyphens, and underscores only
    const validKeyRegex = /^[a-zA-Z0-9_-]+$/;
    if (!validKeyRegex.test(key)) {
      throw BlobError.invalidKey(
        key,
        'Key must contain only alphanumeric characters, hyphens, and underscores',
      );
    }
  }
}
