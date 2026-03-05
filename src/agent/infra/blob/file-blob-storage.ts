import {randomUUID} from 'node:crypto'
import * as fs from 'node:fs/promises'
import {join} from 'node:path'

import type {
  BlobMetadata,
  BlobStats,
  BlobStorageConfig,
  StoredBlob,
} from '../../core/domain/blob/types.js'
import type {IBlobStorage} from '../../core/interfaces/i-blob-storage.js'

import {BlobError} from '../../core/domain/errors/blob-error.js'

/**
 * Metadata stored alongside each blob on disk.
 */
interface StoredMetadata {
  contentType?: string
  createdAt: number
  originalName?: string
  size: number
  tags?: Record<string, string>
  updatedAt: number
}

/**
 * In-memory entry for testing mode.
 */
interface MemoryEntry {
  content: Buffer
  metadata: StoredMetadata
}

/**
 * File-based blob storage implementation.
 *
 * Stores blobs as individual files on the filesystem:
 *   {storageDir}/blobs/{key}/content.bin  — binary content
 *   {storageDir}/blobs/{key}/metadata.json — JSON metadata
 *
 * Features:
 * - One directory per blob (O(1) read/write/delete)
 * - Atomic writes via write-to-temp + rename
 * - Size limit enforcement (per-blob and total)
 * - In-memory mode for fast unit tests
 * - Prefix-based listing via readdir
 */
export class FileBlobStorage implements IBlobStorage {
  private readonly baseDir: string
  private initialized = false
  private readonly inMemory: boolean
  private readonly maxBlobSize: number
  private readonly maxTotalSize: number
  private memoryStore: Map<string, MemoryEntry> | null = null
  private readonly storageDir: string

  constructor(config?: Partial<BlobStorageConfig>) {
    this.inMemory = config?.inMemory ?? false
    this.storageDir = config?.storageDir ?? ''
    if (!this.inMemory && !this.storageDir) {
      throw new Error('FileBlobStorage: storageDir is required when inMemory is false')
    }

    this.baseDir = join(this.storageDir, 'blobs')
    this.maxBlobSize = config?.maxBlobSize ?? 100 * 1024 * 1024 // 100MB default
    this.maxTotalSize = config?.maxTotalSize ?? 1024 * 1024 * 1024 // 1GB default
  }

  /**
   * Clear all blobs from storage.
   */
  async clear(): Promise<void> {
    this.ensureInitialized()

    try {
      if (this.inMemory) {
        this.memoryStore!.clear()
        return
      }

      // Read all entries and remove each directory
      let entries
      try {
        entries = await fs.readdir(this.baseDir, {withFileTypes: true})
      } catch {
        return // Nothing to clear
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = join(this.baseDir, entry.name)
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(dirPath, {force: true, recursive: true})
        }
      }
    } catch (error) {
      if (error instanceof BlobError) {
        throw error
      }

      throw BlobError.deleteError(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Close the storage. Releases in-memory data.
   */
  close(): void {
    if (this.inMemory) {
      this.memoryStore = null
    }

    this.initialized = false
  }

  /**
   * Delete a blob by its key.
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized()
    this.validateKey(key)

    if (this.inMemory) {
      if (!this.memoryStore!.has(key)) {
        throw BlobError.notFound(key)
      }

      this.memoryStore!.delete(key)
      return
    }

    const blobDir = join(this.baseDir, key)
    try {
      await fs.access(blobDir)
    } catch {
      throw BlobError.notFound(key)
    }

    try {
      await fs.rm(blobDir, {force: true, recursive: true})
    } catch (error) {
      throw BlobError.deleteError(
        `Failed to delete blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Check if a blob exists.
   */
  async exists(key: string): Promise<boolean> {
    this.ensureInitialized()
    this.validateKey(key)

    if (this.inMemory) {
      return this.memoryStore!.has(key)
    }

    try {
      await fs.access(join(this.baseDir, key, 'metadata.json'))
      return true
    } catch {
      return false
    }
  }

  /**
   * Get metadata for a blob without retrieving its content.
   */
  async getMetadata(key: string): Promise<BlobMetadata | undefined> {
    this.ensureInitialized()
    this.validateKey(key)

    try {
      if (this.inMemory) {
        const entry = this.memoryStore!.get(key)
        return entry ? this.toPublicMetadata(entry.metadata) : undefined
      }

      return this.readMetadataFromDisk(key)
    } catch (error) {
      if (error instanceof BlobError) {
        throw error
      }

      throw BlobError.retrievalError(
        `Failed to read metadata for blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Get storage statistics.
   */
  async getStats(): Promise<BlobStats> {
    this.ensureInitialized()

    try {
      if (this.inMemory) {
        let totalSize = 0
        for (const entry of this.memoryStore!.values()) {
          totalSize += entry.metadata.size
        }

        return {
          lastUpdated: Date.now(),
          totalBlobs: this.memoryStore!.size,
          totalSize,
        }
      }

      return this.getStatsFromDisk()
    } catch (error) {
      if (error instanceof BlobError) {
        throw error
      }

      throw BlobError.retrievalError(
        `Failed to get storage stats: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Initialize the storage backend.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      if (this.inMemory) {
        this.memoryStore = new Map()
      } else {
        await fs.mkdir(this.baseDir, {recursive: true})
      }

      this.initialized = true
    } catch (error) {
      throw BlobError.initializationError(
        `Failed to initialize file blob storage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * List all blob keys, optionally filtered by prefix.
   */
  async list(prefix?: string): Promise<string[]> {
    this.ensureInitialized()

    try {
      if (this.inMemory) {
        let keys = [...this.memoryStore!.keys()]
        if (prefix) {
          keys = keys.filter((k) => k.startsWith(prefix))
        }

        keys.sort()
        return keys
      }

      return this.listFromDisk(prefix)
    } catch (error) {
      if (error instanceof BlobError) {
        throw error
      }

      throw BlobError.retrievalError(
        `Failed to list blobs: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Retrieve a blob by its key.
   */
  async retrieve(key: string): Promise<StoredBlob | undefined> {
    this.ensureInitialized()
    this.validateKey(key)

    try {
      if (this.inMemory) {
        const entry = this.memoryStore!.get(key)
        if (!entry) {
          return undefined
        }

        return {
          content: entry.content,
          key,
          metadata: this.toPublicMetadata(entry.metadata),
        }
      }

      return this.retrieveFromDisk(key)
    } catch (error) {
      if (error instanceof BlobError) {
        throw error
      }

      throw BlobError.retrievalError(
        `Failed to retrieve blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Store a blob with optional metadata.
   */
  async store(key: string, content: Buffer | string, metadata?: Partial<BlobMetadata>): Promise<StoredBlob> {
    this.ensureInitialized()
    this.validateKey(key)

    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)

    // Check individual blob size
    if (buffer.length > this.maxBlobSize) {
      throw BlobError.tooLarge(buffer.length, this.maxBlobSize)
    }

    // Check total storage size
    const stats = await this.getStats()
    const existing = await this.retrieve(key)
    const existingSize = existing?.metadata.size ?? 0
    const newTotalSize = stats.totalSize - existingSize + buffer.length

    if (newTotalSize > this.maxTotalSize) {
      throw BlobError.totalSizeExceeded(stats.totalSize - existingSize, buffer.length, this.maxTotalSize)
    }

    const now = Date.now()
    const fullMetadata: BlobMetadata = {
      createdAt: existing?.metadata.createdAt ?? now,
      size: buffer.length,
      updatedAt: now,
      ...metadata,
    }

    const storedMeta: StoredMetadata = {
      createdAt: fullMetadata.createdAt,
      size: buffer.length,
      updatedAt: fullMetadata.updatedAt,
    }
    if (fullMetadata.contentType) {
      storedMeta.contentType = fullMetadata.contentType
    }

    if (fullMetadata.originalName) {
      storedMeta.originalName = fullMetadata.originalName
    }

    if (fullMetadata.tags) {
      storedMeta.tags = fullMetadata.tags
    }

    try {
      if (this.inMemory) {
        this.memoryStore!.set(key, {content: buffer, metadata: storedMeta})
      } else {
        await this.writeToDisk(key, buffer, storedMeta)
      }

      return {
        content: buffer,
        key,
        metadata: fullMetadata,
      }
    } catch (error) {
      if (error instanceof BlobError) {
        throw error
      }

      throw BlobError.storageError(
        `Failed to store blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw BlobError.notInitialized()
    }
  }

  /**
   * Get stats by scanning the blobs directory.
   */
  private async getStatsFromDisk(): Promise<BlobStats> {
    let totalBlobs = 0
    let totalSize = 0

    let entries
    try {
      entries = await fs.readdir(this.baseDir, {withFileTypes: true})
    } catch {
      return {lastUpdated: Date.now(), totalBlobs: 0, totalSize: 0}
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const metaPath = join(this.baseDir, entry.name, 'metadata.json')
          // eslint-disable-next-line no-await-in-loop
          const metaContent = await fs.readFile(metaPath, 'utf8')
          const meta = JSON.parse(metaContent) as StoredMetadata
          totalBlobs++
          totalSize += meta.size
        } catch {
          // Skip corrupt entries
        }
      }
    }

    return {lastUpdated: Date.now(), totalBlobs, totalSize}
  }

  /**
   * List keys from disk, optionally filtered by prefix.
   */
  private async listFromDisk(prefix?: string): Promise<string[]> {
    let entries
    try {
      entries = await fs.readdir(this.baseDir, {withFileTypes: true})
    } catch {
      return []
    }

    let keys = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)

    if (prefix) {
      keys = keys.filter((k) => k.startsWith(prefix))
    }

    keys.sort()
    return keys
  }

  /**
   * Read metadata from disk for a given key.
   */
  private async readMetadataFromDisk(key: string): Promise<BlobMetadata | undefined> {
    const metaPath = join(this.baseDir, key, 'metadata.json')
    try {
      const content = await fs.readFile(metaPath, 'utf8')
      const stored = JSON.parse(content) as StoredMetadata
      return this.toPublicMetadata(stored)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }

      throw error
    }
  }

  /**
   * Retrieve a blob from disk.
   */
  private async retrieveFromDisk(key: string): Promise<StoredBlob | undefined> {
    const blobDir = join(this.baseDir, key)
    const contentPath = join(blobDir, 'content.bin')
    const metaPath = join(blobDir, 'metadata.json')

    try {
      const [contentBuf, metaContent] = await Promise.all([
        fs.readFile(contentPath),
        fs.readFile(metaPath, 'utf8'),
      ])

      const stored = JSON.parse(metaContent) as StoredMetadata

      return {
        content: contentBuf,
        key,
        metadata: this.toPublicMetadata(stored),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }

      throw error
    }
  }

  /**
   * Convert StoredMetadata to public BlobMetadata.
   */
  private toPublicMetadata(stored: StoredMetadata): BlobMetadata {
    const metadata: BlobMetadata = {
      createdAt: stored.createdAt,
      size: stored.size,
      updatedAt: stored.updatedAt,
    }

    if (stored.contentType) {
      metadata.contentType = stored.contentType
    }

    if (stored.originalName) {
      metadata.originalName = stored.originalName
    }

    if (stored.tags) {
      metadata.tags = stored.tags
    }

    return metadata
  }

  /**
   * Validate blob key.
   * Keys must be alphanumeric with hyphens and underscores only.
   */
  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw BlobError.invalidKey(String(key), 'Key must be a non-empty string')
    }

    if (key.length === 0) {
      throw BlobError.invalidKey(key, 'Key cannot be empty')
    }

    const validKeyRegex = /^[a-zA-Z0-9_-]+$/
    if (!validKeyRegex.test(key)) {
      throw BlobError.invalidKey(key, 'Key must contain only alphanumeric characters, hyphens, and underscores')
    }
  }

  /**
   * Write blob content and metadata to disk atomically.
   */
  private async writeToDisk(key: string, content: Buffer, metadata: StoredMetadata): Promise<void> {
    const blobDir = join(this.baseDir, key)
    await fs.mkdir(blobDir, {recursive: true})

    const contentPath = join(blobDir, 'content.bin')
    const metaPath = join(blobDir, 'metadata.json')

    const tmpSuffix = `.tmp.${randomUUID()}`

    // Write content atomically
    const tmpContentPath = `${contentPath}${tmpSuffix}`
    await fs.writeFile(tmpContentPath, content)
    await fs.rename(tmpContentPath, contentPath)

    // Write metadata atomically
    const tmpMetaPath = `${metaPath}${tmpSuffix}`
    await fs.writeFile(tmpMetaPath, JSON.stringify(metadata, null, 2), 'utf8')
    await fs.rename(tmpMetaPath, metaPath)
  }
}
