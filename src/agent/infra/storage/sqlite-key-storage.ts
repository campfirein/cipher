import Database from 'better-sqlite3'
import * as fs from 'node:fs/promises'
import {join} from 'node:path'

import type {BatchOperation, IKeyStorage, StorageKey} from '../../core/interfaces/i-key-storage.js'

import {lockKeyFromStorageKey, RWLock} from '../llm/context/rw-lock.js'

/**
 * Configuration for SQLite key storage
 */
export interface SqliteKeyStorageConfig {
  /**
   * Database file path (relative or absolute).
   * Defaults to 'context.db'
   */
  dbPath?: string

  /**
   * Enable in-memory mode for testing.
   * Defaults to false.
   */
  inMemory?: boolean

  /**
   * Storage directory for the database file.
   * Defaults to process.cwd()/.brv/blobs
   */
  storageDir?: string
}

/**
 * SQLite-based key storage implementation.
 *
 * Stores key-value pairs where keys are hierarchical (StorageKey = string[])
 * and values are JSON-serializable objects.
 *
 * Key path structure:
 * - ["session", sessionId] → Session metadata
 * - ["message", sessionId, messageId] → Individual message
 * - ["part", messageId, partId] → Message part (tool output, file, etc.)
 *
 * Schema:
 * - key_store: key_path (primary), value (JSON blob), created_at, updated_at
 *
 * Features:
 * - Hierarchical key organization with prefix-based listing
 * - Reader-writer locks for concurrent access
 * - Atomic batch operations
 * - ACID transactions via SQLite
 */
export class SqliteKeyStorage implements IKeyStorage {
  private db: Database.Database | null = null
  private readonly dbPath: string
  private initialized = false
  private readonly inMemory: boolean
  private readonly storageDir: string

  constructor(config?: SqliteKeyStorageConfig) {
    this.inMemory = config?.inMemory ?? false
    this.storageDir = config?.storageDir ?? join(process.cwd(), '.brv', 'blobs')
    this.dbPath = this.inMemory ? ':memory:' : join(this.storageDir, config?.dbPath ?? 'context.db')
  }

  /**
   * Execute batch operations atomically.
   * All operations succeed or fail together.
   */
  async batch(operations: BatchOperation[]): Promise<void> {
    this.ensureInitialized()

    if (operations.length === 0) {
      return
    }

    // Acquire write lock for all affected keys
    const lockKey = 'batch:global'
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    const runBatch = this.db!.transaction(() => {
      for (const op of operations) {
        const keyPath = this.serializeKey(op.key)

        if (op.type === 'set') {
          const now = Date.now()
          const valueJson = JSON.stringify(op.value)

          // Check if exists to preserve created_at
          const existing = this.db!.prepare('SELECT created_at FROM key_store WHERE key_path = ?').get(keyPath) as
            | undefined
            | {created_at: number}

          this.db!.prepare(
            `
            INSERT INTO key_store (key_path, value, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key_path) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `,
          ).run(keyPath, Buffer.from(valueJson), existing?.created_at ?? now, now)
        } else if (op.type === 'delete') {
          this.db!.prepare('DELETE FROM key_store WHERE key_path = ?').run(keyPath)
        }
      }
    })

    try {
      runBatch()
    } catch (error) {
      throw new Error(`Batch operation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
    }
  }

  /**
   * Delete a value by its composite key.
   */
  async delete(key: StorageKey): Promise<boolean> {
    this.ensureInitialized()
    const keyPath = this.serializeKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    try {
      const result = this.db!.prepare('DELETE FROM key_store WHERE key_path = ?').run(keyPath)
      return result.changes > 0
    } catch (error) {
      throw new Error(`Failed to delete key ${keyPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Check if a key exists.
   */
  async exists(key: StorageKey): Promise<boolean> {
    this.ensureInitialized()
    const keyPath = this.serializeKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.read(lockKey)

    const row = this.db!.prepare('SELECT 1 FROM key_store WHERE key_path = ?').get(keyPath)
    return row !== undefined
  }

  /**
   * Get a value by its composite key.
   */
  async get<T>(key: StorageKey): Promise<T | undefined> {
    this.ensureInitialized()
    const keyPath = this.serializeKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.read(lockKey)

    try {
      const row = this.db!.prepare('SELECT value FROM key_store WHERE key_path = ?').get(keyPath) as
        | undefined
        | {value: Buffer}

      if (!row) {
        return undefined
      }

      return JSON.parse(row.value.toString('utf8')) as T
    } catch (error) {
      throw new Error(`Failed to get key ${keyPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Initialize the storage backend.
   * Creates the database and runs migrations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      // Ensure storage directory exists (skip for in-memory)
      if (!this.inMemory) {
        await fs.mkdir(this.storageDir, {recursive: true})
      }

      // Open/create database
      this.db = new Database(this.dbPath)

      // Enable WAL mode for better concurrent performance
      this.db.pragma('journal_mode = WAL')

      // Create key_store table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS key_store (
          key_path TEXT PRIMARY KEY,
          value BLOB NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)

      // Create index for prefix-based listing
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_key_store_prefix ON key_store(key_path)`)

      this.initialized = true
    } catch (error) {
      throw new Error(
        `Failed to initialize SQLite key storage: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * List all keys matching a prefix.
   */
  async list(prefix: StorageKey): Promise<StorageKey[]> {
    this.ensureInitialized()
    const prefixPath = this.serializeKey(prefix)
    const lockKey = lockKeyFromStorageKey(prefix)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.read(lockKey)

    try {
      // Use LIKE with prefix pattern for efficient prefix matching
      const rows = this.db!.prepare('SELECT key_path FROM key_store WHERE key_path LIKE ? ORDER BY key_path').all(
        `${prefixPath}%`,
      ) as Array<{key_path: string}>

      return rows.map((row) => this.deserializeKey(row.key_path))
    } catch (error) {
      throw new Error(`Failed to list keys with prefix ${prefixPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Set a value at a composite key.
   */
  async set<T>(key: StorageKey, value: T): Promise<void> {
    this.ensureInitialized()
    const keyPath = this.serializeKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    const now = Date.now()
    const valueJson = JSON.stringify(value)

    try {
      // Check if exists to preserve created_at
      const existing = this.db!.prepare('SELECT created_at FROM key_store WHERE key_path = ?').get(keyPath) as
        | undefined
        | {created_at: number}

      this.db!.prepare(
        `
        INSERT INTO key_store (key_path, value, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key_path) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      ).run(keyPath, Buffer.from(valueJson), existing?.created_at ?? now, now)
    } catch (error) {
      throw new Error(`Failed to set key ${keyPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Atomic update with optimistic locking.
   */
  async update<T>(key: StorageKey, updater: (current: T | undefined) => T): Promise<T> {
    this.ensureInitialized()
    const keyPath = this.serializeKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    try {
      // Read current value
      const row = this.db!.prepare('SELECT value, created_at FROM key_store WHERE key_path = ?').get(keyPath) as
        undefined | {created_at: number; value: Buffer}

      const currentValue = row ? (JSON.parse(row.value.toString('utf8')) as T) : undefined

      // Apply updater function
      const newValue = updater(currentValue)

      // Write new value
      const now = Date.now()
      const valueJson = JSON.stringify(newValue)

      this.db!.prepare(
        `
        INSERT INTO key_store (key_path, value, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key_path) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      ).run(keyPath, Buffer.from(valueJson), row?.created_at ?? now, now)

      return newValue
    } catch (error) {
      throw new Error(`Failed to update key ${keyPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Deserialize a key path string back to StorageKey.
   * Converts "message:session123:msg456" to ["message", "session123", "msg456"]
   */
  private deserializeKey(keyPath: string): StorageKey {
    return keyPath.split(':')
  }

  /**
   * Ensure storage has been initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('SqliteKeyStorage not initialized. Call initialize() first.')
    }
  }

  /**
   * Serialize a StorageKey to a string path.
   * Converts ["message", "session123", "msg456"] to "message:session123:msg456"
   */
  private serializeKey(key: StorageKey): string {
    if (key.length === 0) {
      throw new Error('Storage key cannot be empty')
    }

    // Validate key segments don't contain the separator
    for (const segment of key) {
      if (segment.includes(':')) {
        throw new Error(`Key segment cannot contain ':': ${segment}`)
      }
    }

    return key.join(':')
  }
}

/**
 * Factory function to create SqliteKeyStorage with common defaults.
 */
export function createKeyStorage(config?: SqliteKeyStorageConfig): SqliteKeyStorage {
  return new SqliteKeyStorage(config)
}
