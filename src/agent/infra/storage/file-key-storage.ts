import {randomUUID} from 'node:crypto'
import * as fs from 'node:fs/promises'
import {join} from 'node:path'

import type {BatchOperation, IKeyStorage, StorageKey} from '../../core/interfaces/i-key-storage.js'

import {lockKeyFromStorageKey, RWLock} from '../llm/context/rw-lock.js'

/**
 * Envelope stored on disk for each key-value pair.
 */
interface StoredEnvelope<T = unknown> {
  createdAt: number
  updatedAt: number
  value: T
}

/**
 * Configuration for file-based key storage.
 */
export interface FileKeyStorageConfig {
  /**
   * Enable in-memory mode for testing.
   * Uses a Map instead of the filesystem — no I/O, fast unit tests.
   * Defaults to false.
   */
  inMemory?: boolean

  /**
   * Storage directory for the keystore.
   * Required when inMemory is false.
   */
  storageDir?: string
}

/**
 * File-based key storage implementation.
 *
 * Stores key-value pairs as individual JSON files on the filesystem.
 * Composite keys map to directory paths:
 *   ["message", sessionId, msgId] → {storageDir}/keystore/message/{sessionId}/{msgId}.json
 *
 * Features:
 * - One file per entity (O(1) read/write/delete)
 * - Atomic writes via write-to-temp + rename
 * - Reader-writer locks for concurrent access (reuses global RWLock)
 * - In-memory mode for fast unit tests
 * - Hierarchical prefix listing via readdir
 */
export class FileKeyStorage implements IKeyStorage {
  private readonly baseDir: string
  private initialized = false
  private readonly inMemory: boolean
  private memoryStore: Map<string, StoredEnvelope> | null = null
  private readonly storageDir: string

  constructor(config?: FileKeyStorageConfig) {
    this.inMemory = config?.inMemory ?? false
    this.storageDir = config?.storageDir ?? ''
    if (!this.inMemory && !this.storageDir) {
      throw new Error('FileKeyStorage: storageDir is required when inMemory is false')
    }

    this.baseDir = join(this.storageDir, 'keystore')
  }

  /**
   * Execute batch operations.
   * Operations are executed sequentially with write-temp-rename per operation.
   * Best-effort: not ACID across multiple files, but each individual
   * file write is atomic via rename.
   */
  async batch(operations: BatchOperation[]): Promise<void> {
    this.ensureInitialized()

    if (operations.length === 0) {
      return
    }

    const lockKey = 'batch:global'
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    try {
      for (const op of operations) {
        if (op.type === 'set') {
          const now = Date.now()
          // eslint-disable-next-line no-await-in-loop
          const existing = await this.readEnvelope(op.key)
          const envelope: StoredEnvelope = {
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            value: op.value,
          }
          // eslint-disable-next-line no-await-in-loop
          await this.writeEnvelope(op.key, envelope)
        } else if (op.type === 'delete') {
          // eslint-disable-next-line no-await-in-loop
          await this.removeFile(op.key)
        }
      }
    } catch (error) {
      throw new Error(`Batch operation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Close the storage. No-op for file-based storage.
   */
  close(): void {
    if (this.inMemory) {
      this.memoryStore = null
    }

    this.initialized = false
  }

  /**
   * Delete a value by its composite key.
   */
  async delete(key: StorageKey): Promise<boolean> {
    this.ensureInitialized()
    this.validateKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    return this.removeFile(key)
  }

  /**
   * Check if a key exists.
   */
  async exists(key: StorageKey): Promise<boolean> {
    this.ensureInitialized()
    this.validateKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.read(lockKey)

    if (this.inMemory) {
      return this.memoryStore!.has(this.serializeKey(key))
    }

    try {
      await fs.access(this.keyToPath(key))
      return true
    } catch {
      return false
    }
  }

  /**
   * Get a value by its composite key.
   */
  async get<T>(key: StorageKey): Promise<T | undefined> {
    this.ensureInitialized()
    this.validateKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.read(lockKey)

    try {
      const envelope = await this.readEnvelope(key)
      return envelope?.value as T | undefined
    } catch (error) {
      throw new Error(`Failed to get key ${this.serializeKey(key)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Initialize the storage backend.
   * Creates the base keystore directory.
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
      throw new Error(
        `Failed to initialize file key storage: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * List all keys matching a prefix.
   */
  async list(prefix: StorageKey): Promise<StorageKey[]> {
    this.ensureInitialized()
    const lockKey = lockKeyFromStorageKey(prefix)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.read(lockKey)

    try {
      if (this.inMemory) {
        return this.listInMemory(prefix)
      }

      return this.listFromDisk(prefix)
    } catch (error) {
      throw new Error(`Failed to list keys with prefix ${this.serializeKey(prefix)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * List all key-value pairs matching a prefix.
   * More efficient than list() followed by individual get() calls.
   */
  async listWithValues<T>(prefix: StorageKey): Promise<Array<{key: StorageKey; value: T}>> {
    this.ensureInitialized()
    const lockKey = lockKeyFromStorageKey(prefix)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.read(lockKey)

    try {
      if (this.inMemory) {
        return this.listWithValuesInMemory<T>(prefix)
      }

      return this.listWithValuesFromDisk<T>(prefix)
    } catch (error) {
      throw new Error(
        `Failed to list keys with values for prefix ${this.serializeKey(prefix)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Set a value at a composite key.
   */
  async set<T>(key: StorageKey, value: T): Promise<void> {
    this.ensureInitialized()
    this.validateKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    const now = Date.now()

    try {
      // Preserve createdAt if key already exists
      const existing = await this.readEnvelope(key)
      const envelope: StoredEnvelope = {
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        value,
      }

      await this.writeEnvelope(key, envelope)
    } catch (error) {
      throw new Error(`Failed to set key ${this.serializeKey(key)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Atomic update with optimistic locking.
   */
  async update<T>(key: StorageKey, updater: (current: T | undefined) => T): Promise<T> {
    this.ensureInitialized()
    this.validateKey(key)
    const lockKey = lockKeyFromStorageKey(key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    using _lock = await RWLock.write(lockKey)

    try {
      const existing = await this.readEnvelope(key)
      const currentValue = existing?.value as T | undefined

      const newValue = updater(currentValue)

      const now = Date.now()
      const envelope: StoredEnvelope = {
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        value: newValue,
      }

      await this.writeEnvelope(key, envelope)

      return newValue
    } catch (error) {
      throw new Error(`Failed to update key ${this.serializeKey(key)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Deserialize a colon-separated string back to a StorageKey.
   */
  private deserializeKey(keyStr: string): StorageKey {
    return keyStr.split(':')
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FileKeyStorage not initialized. Call initialize() first.')
    }
  }

  /**
   * Convert a StorageKey to a filesystem path.
   * ["message", "abc", "msg1"] → {baseDir}/message/abc/msg1.json
   */
  private keyToPath(key: StorageKey): string {
    const segments = [...key]
    const last = segments.pop()!
    const dir = segments.length > 0 ? join(this.baseDir, ...segments) : this.baseDir
    return join(dir, `${last}.json`)
  }

  /**
   * List keys from disk by scanning the prefix directory.
   */
  private async listFromDisk(prefix: StorageKey): Promise<StorageKey[]> {
    const prefixDir = join(this.baseDir, ...prefix)
    const results: StorageKey[] = []

    try {
      await fs.access(prefixDir)
    } catch {
      return results
    }

    await this.scanDirectory(prefixDir, prefix, results)
    results.sort((a, b) => this.serializeKey(a).localeCompare(this.serializeKey(b)))
    return results
  }

  /**
   * List keys from in-memory store matching a prefix.
   */
  private listInMemory(prefix: StorageKey): StorageKey[] {
    const prefixStr = this.serializeKey(prefix)
    const results: StorageKey[] = []

    for (const storedKey of this.memoryStore!.keys()) {
      if (storedKey.startsWith(prefixStr)) {
        results.push(this.deserializeKey(storedKey))
      }
    }

    results.sort((a, b) => this.serializeKey(a).localeCompare(this.serializeKey(b)))
    return results
  }

  /**
   * List keys with values from disk.
   */
  private async listWithValuesFromDisk<T>(prefix: StorageKey): Promise<Array<{key: StorageKey; value: T}>> {
    const keys = await this.listFromDisk(prefix)
    const results: Array<{key: StorageKey; value: T}> = []

    for (const key of keys) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const envelope = await this.readEnvelope(key)
        if (envelope) {
          results.push({key, value: envelope.value as T})
        }
      } catch {
        // Skip corrupt or unreadable files
      }
    }

    return results
  }

  /**
   * List keys with values from in-memory store.
   */
  private listWithValuesInMemory<T>(prefix: StorageKey): Array<{key: StorageKey; value: T}> {
    const prefixStr = this.serializeKey(prefix)
    const results: Array<{key: StorageKey; value: T}> = []

    for (const [storedKey, envelope] of this.memoryStore!.entries()) {
      if (storedKey.startsWith(prefixStr)) {
        results.push({key: this.deserializeKey(storedKey), value: envelope.value as T})
      }
    }

    results.sort((a, b) => this.serializeKey(a.key).localeCompare(this.serializeKey(b.key)))
    return results
  }

  /**
   * Read the stored envelope for a key. Returns undefined if not found.
   */
  private async readEnvelope(key: StorageKey): Promise<StoredEnvelope | undefined> {
    if (this.inMemory) {
      return this.memoryStore!.get(this.serializeKey(key))
    }

    const filePath = this.keyToPath(key)
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return JSON.parse(content) as StoredEnvelope
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }

      throw error
    }
  }

  /**
   * Remove a file for the given key. Returns true if it existed.
   */
  private async removeFile(key: StorageKey): Promise<boolean> {
    if (this.inMemory) {
      return this.memoryStore!.delete(this.serializeKey(key))
    }

    const filePath = this.keyToPath(key)
    try {
      await fs.unlink(filePath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }

      throw error
    }
  }

  /**
   * Recursively scan a directory to collect all storage keys.
   */
  private async scanDirectory(dir: string, prefix: StorageKey, results: StorageKey[]): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      // Skip temp files from atomic writes
      if (entry.name.includes('.tmp.')) {
        continue
      }

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await this.scanDirectory(fullPath, [...prefix, entry.name], results)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const segment = entry.name.slice(0, -5) // Remove .json
        results.push([...prefix, segment])
      }
    }
  }

  /**
   * Serialize a StorageKey to a string for in-memory store lookups.
   * Uses ':' separator (same as lockKeyFromStorageKey).
   */
  private serializeKey(key: StorageKey): string {
    return key.join(':')
  }

  /**
   * Validate key segments.
   */
  private validateKey(key: StorageKey): void {
    if (key.length === 0) {
      throw new Error('Storage key cannot be empty')
    }

    for (const segment of key) {
      if (!segment) {
        throw new Error('Key segment cannot be empty')
      }

      if (segment.includes(':')) {
        throw new Error(`Key segment cannot contain ':': ${segment}`)
      }

      if (segment.includes('/') || segment.includes('\\')) {
        throw new Error(`Key segment cannot contain path separators: ${segment}`)
      }

      if (segment === '..' || segment === '.') {
        throw new Error(`Key segment cannot be '${segment}'`)
      }
    }
  }

  /**
   * Write an envelope to disk using atomic write-to-temp + rename.
   */
  private async writeEnvelope(key: StorageKey, envelope: StoredEnvelope): Promise<void> {
    if (this.inMemory) {
      this.memoryStore!.set(this.serializeKey(key), envelope)
      return
    }

    const filePath = this.keyToPath(key)
    const dir = join(filePath, '..')
    await fs.mkdir(dir, {recursive: true})

    const tmpPath = `${filePath}.tmp.${randomUUID()}`
    const content = JSON.stringify(envelope, null, 2)

    await fs.writeFile(tmpPath, content, 'utf8')
    await fs.rename(tmpPath, filePath)
  }
}

/**
 * Factory function to create FileKeyStorage with common defaults.
 */
export function createFileKeyStorage(config?: FileKeyStorageConfig): FileKeyStorage {
  return new FileKeyStorage(config)
}
