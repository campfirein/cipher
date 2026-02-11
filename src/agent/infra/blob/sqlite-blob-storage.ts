import Database from 'better-sqlite3'
import * as fs from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {
  BlobLogger,
  BlobMetadata,
  BlobStats,
  BlobStorageConfig,
  StoredBlob,
} from '../../core/domain/blob/types.js'
import type {IBlobStorage} from '../../core/interfaces/i-blob-storage.js'

import {BlobError} from '../../core/domain/errors/blob-error.js'
import {runMigrations} from './migrations.js'

/**
 * Database row type for blobs table
 */
interface BlobRow {
  content: Buffer
  content_type: null | string
  created_at: number
  key: string
  original_name: null | string
  size: number
  tags: null | string
  updated_at: number
}

/**
 * SQLite-based blob storage implementation
 *
 * Stores all blobs in a single SQLite database file:
 * - .brv/storage.db
 *
 * Schema:
 * - blobs: key, content, content_type, original_name, size, tags, created_at, updated_at
 *
 * Benefits over file-based storage:
 * - O(1) lookup for exists/retrieve
 * - Fast listing and filtering
 * - ACID transactions for data integrity
 * - Single file for easy backup/migration
 */
export class SqliteBlobStorage implements IBlobStorage {
  private db: Database.Database | null = null
  private readonly dbPath: string
  private initialized = false
  private readonly inMemory: boolean
  private readonly logger: BlobLogger
  private readonly maxBlobSize: number
  private readonly maxTotalSize: number
  private readonly storageDir: string

  constructor(config?: Partial<BlobStorageConfig>) {
    this.inMemory = config?.inMemory ?? false
    this.storageDir = config?.storageDir ?? ''
    if (!this.inMemory && !this.storageDir) {
      throw new Error('SqliteBlobStorage: storageDir is required when inMemory is false')
    }

    this.dbPath = this.inMemory ? ':memory:' : (config?.dbPath ?? join(this.storageDir, 'storage.db'))
    this.maxBlobSize = config?.maxBlobSize ?? 100 * 1024 * 1024 // 100MB default
    this.maxTotalSize = config?.maxTotalSize ?? 1024 * 1024 * 1024 // 1GB default
    this.logger = config?.logger ?? {
      error: (message: string) => console.error(message),
      info: (message: string) => console.log(message),
    }
  }

  /**
   * Clear all blobs from storage
   * WARNING: This is a destructive operation
   */
  async clear(): Promise<void> {
    this.ensureInitialized()

    try {
      this.db!.exec('DELETE FROM blobs')
    } catch (error) {
      throw BlobError.deleteError(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
    }
  }

  /**
   * Delete a blob by its key
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized()
    this.validateKey(key)

    try {
      const stmt = this.db!.prepare('DELETE FROM blobs WHERE key = ?')
      const result = stmt.run(key)

      if (result.changes === 0) {
        throw BlobError.notFound(key)
      }
    } catch (error) {
      if (error instanceof BlobError) {
        throw error
      }

      throw BlobError.deleteError(
        `Failed to delete blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Check if a blob exists
   */
  async exists(key: string): Promise<boolean> {
    this.ensureInitialized()
    this.validateKey(key)

    const stmt = this.db!.prepare('SELECT 1 FROM blobs WHERE key = ?')
    const row = stmt.get(key)
    return row !== undefined
  }

  /**
   * Get metadata for a blob without retrieving its content
   */
  async getMetadata(key: string): Promise<BlobMetadata | undefined> {
    this.ensureInitialized()
    this.validateKey(key)

    try {
      const stmt = this.db!.prepare(`
        SELECT content_type, original_name, size, tags, created_at, updated_at
        FROM blobs WHERE key = ?
      `)
      const row = stmt.get(key) as Omit<BlobRow, 'content' | 'key'> | undefined

      if (!row) {
        return undefined
      }

      return this.rowToMetadata(row)
    } catch (error) {
      throw BlobError.retrievalError(
        `Failed to read metadata for blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<BlobStats> {
    this.ensureInitialized()

    try {
      const stmt = this.db!.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as total_size
        FROM blobs
      `)
      const row = stmt.get() as {count: number; total_size: number}

      return {
        lastUpdated: Date.now(),
        totalBlobs: row.count,
        totalSize: row.total_size,
      }
    } catch (error) {
      throw BlobError.retrievalError(
        `Failed to get storage stats: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Initialize storage by creating the database and running migrations
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      // Ensure parent directory of database file exists (skip for in-memory)
      if (!this.inMemory) {
        await fs.mkdir(dirname(this.dbPath), {recursive: true})
      }

      // Open/create database (':memory:' for in-memory mode)
      this.db = new Database(this.dbPath)

      // Enable WAL mode for better concurrent performance
      this.db.pragma('journal_mode = WAL')

      // Run migrations to ensure schema is up-to-date
      runMigrations(this.db, this.logger)

      this.initialized = true
    } catch (error) {
      throw BlobError.initializationError(
        `Failed to initialize SQLite storage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * List all blob keys, optionally filtered by prefix
   */
  async list(prefix?: string): Promise<string[]> {
    this.ensureInitialized()

    try {
      let stmt
      let rows: Array<{key: string}>

      if (prefix) {
        stmt = this.db!.prepare('SELECT key FROM blobs WHERE key LIKE ? ORDER BY key')
        rows = stmt.all(`${prefix}%`) as Array<{key: string}>
      } else {
        stmt = this.db!.prepare('SELECT key FROM blobs ORDER BY key')
        rows = stmt.all() as Array<{key: string}>
      }

      return rows.map((row) => row.key)
    } catch (error) {
      throw BlobError.retrievalError(
        `Failed to list blobs: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Retrieve a blob by its key
   */
  async retrieve(key: string): Promise<StoredBlob | undefined> {
    this.ensureInitialized()
    this.validateKey(key)

    try {
      const stmt = this.db!.prepare('SELECT * FROM blobs WHERE key = ?')
      const row = stmt.get(key) as BlobRow | undefined

      if (!row) {
        return undefined
      }

      return {
        content: row.content,
        key: row.key,
        metadata: this.rowToMetadata(row),
      }
    } catch (error) {
      throw BlobError.retrievalError(
        `Failed to retrieve blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Store a blob with optional metadata
   */
  async store(key: string, content: Buffer | string, metadata?: Partial<BlobMetadata>): Promise<StoredBlob> {
    this.ensureInitialized()
    this.validateKey(key)

    // Convert content to Buffer
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)

    // Check individual blob size
    if (buffer.length > this.maxBlobSize) {
      throw BlobError.tooLarge(buffer.length, this.maxBlobSize)
    }

    // Check total storage size
    const stats = await this.getStats()
    const existingBlob = await this.retrieve(key)
    const existingSize = existingBlob?.metadata.size ?? 0
    const newTotalSize = stats.totalSize - existingSize + buffer.length

    if (newTotalSize > this.maxTotalSize) {
      throw BlobError.totalSizeExceeded(stats.totalSize - existingSize, buffer.length, this.maxTotalSize)
    }

    const now = Date.now()
    const fullMetadata: BlobMetadata = {
      createdAt: existingBlob?.metadata.createdAt ?? now,
      size: buffer.length,
      updatedAt: now,
      ...metadata,
    }

    try {
      const stmt = this.db!.prepare(`
        INSERT INTO blobs (key, content, content_type, original_name, size, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          content = excluded.content,
          content_type = excluded.content_type,
          original_name = excluded.original_name,
          size = excluded.size,
          tags = excluded.tags,
          updated_at = excluded.updated_at
      `)

      stmt.run(
        key,
        buffer,
        fullMetadata.contentType ?? null,
        fullMetadata.originalName ?? null,
        buffer.length,
        fullMetadata.tags ? JSON.stringify(fullMetadata.tags) : null,
        fullMetadata.createdAt,
        fullMetadata.updatedAt,
      )

      return {
        content: buffer,
        key,
        metadata: fullMetadata,
      }
    } catch (error) {
      throw BlobError.storageError(
        `Failed to store blob ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Ensure storage has been initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw BlobError.notInitialized()
    }
  }

  /**
   * Convert database row to BlobMetadata
   */
  private rowToMetadata(row: Omit<BlobRow, 'content' | 'key'>): BlobMetadata {
    const metadata: BlobMetadata = {
      createdAt: row.created_at,
      size: row.size,
      updatedAt: row.updated_at,
    }

    if (row.content_type) {
      metadata.contentType = row.content_type
    }

    if (row.original_name) {
      metadata.originalName = row.original_name
    }

    if (row.tags) {
      try {
        metadata.tags = JSON.parse(row.tags)
      } catch {
        // Ignore invalid JSON
      }
    }

    return metadata
  }

  /**
   * Validate blob key
   * Keys must be alphanumeric with hyphens and underscores only
   */
  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw BlobError.invalidKey(String(key), 'Key must be a non-empty string')
    }

    if (key.length === 0) {
      throw BlobError.invalidKey(key, 'Key cannot be empty')
    }

    // Allow alphanumeric, hyphens, and underscores only
    const validKeyRegex = /^[a-zA-Z0-9_-]+$/
    if (!validKeyRegex.test(key)) {
      throw BlobError.invalidKey(key, 'Key must contain only alphanumeric characters, hyphens, and underscores')
    }
  }
}
