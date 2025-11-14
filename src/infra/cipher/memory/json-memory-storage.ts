import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import type { Memory } from '../../../core/domain/cipher/memory/types.js';
import type { IMemoryStorage } from '../../../core/interfaces/cipher/i-memory-storage.js';

import { MemoryError } from '../../../core/domain/cipher/errors/memory-error.js';

/**
 * JSON file-based memory storage implementation
 *
 * Stores each memory as a separate JSON file in the configured directory.
 * File naming: {id}.json
 * Default location: .byterover/cipher/memories/
 */
export class JsonMemoryStorage implements IMemoryStorage {
  private initialized = false;
  private readonly storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || join(process.cwd(), '.brv');
  }

  /**
   * Clear all memories by removing all JSON files
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    try {
      const files = await fs.readdir(this.storageDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      await Promise.all(
        jsonFiles.map((file) =>
          fs.unlink(join(this.storageDir, file)).catch((error) => {
            console.warn(`Failed to delete ${file}: ${error.message}`);
          }),
        ),
      );

      console.log(`Cleared ${jsonFiles.length} memories from storage`);
    } catch (error) {
      throw MemoryError.deleteError(
        `Failed to clear storage: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Delete a memory by removing its JSON file
   */
  async delete(id: string): Promise<void> {
    this.ensureInitialized();

    const filePath = this.getFilePath(id);

    try {
      await fs.unlink(filePath);
      console.log(`Deleted memory: ${id}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw MemoryError.notFound(id);
      }

      throw MemoryError.deleteError(
        `Failed to delete memory ${id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Get a memory by reading its JSON file
   */
  async get(id: string): Promise<Memory | undefined> {
    this.ensureInitialized();

    const filePath = this.getFilePath(id);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as Memory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      throw MemoryError.retrievalError(
        `Failed to read memory ${id}: ${error instanceof Error ? error.message : String(error)}`,
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
      await fs.mkdir(this.storageDir, { recursive: true });
      this.initialized = true;
      console.log(`Memory storage initialized at: ${this.storageDir}`);
    } catch (error) {
      throw MemoryError.storageError(
        `Failed to initialize storage directory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * List memory IDs with the given prefix
   * Since we store files as {id}.json, we extract IDs from filenames
   */
  async list(_prefix: string): Promise<string[]> {
    this.ensureInitialized();

    try {
      const files = await fs.readdir(this.storageDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      // Extract IDs from filenames (remove .json extension)
      const ids = jsonFiles.map((file) => file.slice(0, -5));

      // If prefix is provided, filter IDs (prefix format: 'cipher:memory:item:')
      // Since our storage uses just the ID as filename, we return all IDs
      // The manager layer can handle prefix-based filtering if needed
      return ids;
    } catch (error) {
      throw MemoryError.retrievalError(
        `Failed to list memories: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Load all memories from storage
   */
  async loadAll(): Promise<Memory[]> {
    this.ensureInitialized();

    try {
      const ids = await this.list('');
      const memories: Memory[] = [];

      await Promise.all(
        ids.map(async (id) => {
          try {
            const memory = await this.get(id);
            if (memory) {
              memories.push(memory);
            }
          } catch (error) {
            console.warn(
              `Failed to load memory ${id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );

      return memories;
    } catch (error) {
      throw MemoryError.retrievalError(
        `Failed to load all memories: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Save a memory by writing it as a JSON file
   * Uses atomic write (write to temp file, then rename)
   */
  async save(memory: Memory): Promise<void> {
    this.ensureInitialized();

    const filePath = this.getFilePath(memory.id);
    const tempPath = `${filePath}.tmp`;

    try {
      // Write to temporary file first
      await fs.writeFile(tempPath, JSON.stringify(memory, null, 2), 'utf8');

      // Atomic rename
      await fs.rename(tempPath, filePath);

      console.log(`Saved memory: ${memory.id}`);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        if (existsSync(tempPath)) {
          await fs.unlink(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      throw MemoryError.storageError(
        `Failed to save memory ${memory.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Ensure storage has been initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw MemoryError.storageError(
        'Storage not initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Get the file path for a memory ID
   */
  private getFilePath(id: string): string {
    return join(this.storageDir, `${id}.json`);
  }
}
