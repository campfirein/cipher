import { nanoid } from 'nanoid';
import { z } from 'zod';

import type {
  CreateMemoryInput,
  ListMemoriesOptions,
  Memory,
  UpdateMemoryInput,
} from '../../../core/domain/cipher/memory/types.js';
import type { IMemoryStorage } from '../../../core/interfaces/cipher/i-memory-storage.js';

import { MemoryError, MemoryErrorCode } from '../../../core/domain/cipher/errors/memory-error.js';

/**
 * Validation constants
 */
const MAX_CONTENT_LENGTH = 10_000; // 10k characters max per memory
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 10;

/**
 * Embedded Zod schemas for runtime validation
 * Following cipher pattern: schemas are co-located with implementation
 */
const MemorySourceSchema = z.enum(['agent', 'system', 'user']).describe('Source of the memory');

const MemoryMetadataSchema = z
  .object({
    pinned: z.boolean().optional().describe('Whether this memory is pinned for auto-loading'),
    source: MemorySourceSchema.optional().describe('Source of the memory'),
  })
  .passthrough() // Allow additional custom fields
  .describe('Memory metadata');

const MemorySchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(
        MAX_CONTENT_LENGTH,
        `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`,
      )
      .describe('The actual memory content'),
    createdAt: z.number().int().positive().describe('Creation timestamp (Unix ms)'),
    id: z.string().min(1).describe('Unique identifier for the memory'),
    metadata: MemoryMetadataSchema.optional().describe('Additional metadata'),
    tags: z
      .array(z.string().min(1).max(MAX_TAG_LENGTH))
      .max(MAX_TAGS)
      .optional()
      .describe('Optional tags for categorization'),
    updatedAt: z.number().int().positive().describe('Last update timestamp (Unix ms)'),
  })
  .strict()
  .describe('Memory item stored in the system');

const CreateMemoryInputSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(
        MAX_CONTENT_LENGTH,
        `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`,
      )
      .describe('The memory content'),
    metadata: MemoryMetadataSchema.optional().describe('Optional metadata'),
    tags: z
      .array(z.string().min(1).max(MAX_TAG_LENGTH))
      .max(MAX_TAGS)
      .optional()
      .describe('Optional tags'),
  })
  .strict()
  .describe('Input for creating a new memory');

const UpdateMemoryInputSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(
        MAX_CONTENT_LENGTH,
        `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`,
      )
      .optional()
      .describe('Updated content'),
    metadata: MemoryMetadataSchema.optional().describe(
      'Updated metadata (merges with existing)',
    ),
    tags: z
      .array(z.string().min(1).max(MAX_TAG_LENGTH))
      .max(MAX_TAGS)
      .optional()
      .describe('Updated tags (replaces existing)'),
  })
  .strict()
  .describe('Input for updating an existing memory');

const ListMemoriesOptionsSchema = z
  .object({
    limit: z.number().int().positive().optional().describe('Limit number of results'),
    offset: z.number().int().nonnegative().optional().describe('Skip first N results'),
    pinned: z.boolean().optional().describe('Filter by pinned status'),
    source: MemorySourceSchema.optional().describe('Filter by source'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
  })
  .strict()
  .describe('Options for listing memories');

/**
 * MemoryManager handles CRUD operations for cipher agent memories
 *
 * Responsibilities:
 * - Store and retrieve memories using the storage abstraction
 * - Validate memory data using embedded Zod schemas
 * - Generate unique IDs for memories
 * - Filter and search memories by tags, source, and pinned status
 * - Sort memories by recency (updatedAt descending)
 *
 * Storage delegation:
 * - All persistence operations are delegated to IMemoryStorage
 * - Manager focuses on business logic and validation
 */
export class MemoryManager {
  constructor(private storage: IMemoryStorage) {
    console.log('MemoryManager initialized');
  }

  /**
   * Get count of total memories matching the filter criteria
   * @param options - Query options for filtering
   * @returns Number of memories matching the criteria
   */
  async count(options: ListMemoriesOptions = {}): Promise<number> {
    const memories = await this.list(options);
    return memories.length;
  }

  /**
   * Create a new memory
   * @param input - Memory creation input
   * @returns Created memory with generated ID and timestamps
   */
  async create(input: CreateMemoryInput): Promise<Memory> {
    // Validate input
    const validatedInput = CreateMemoryInputSchema.parse(input);

    // Generate unique ID (12 characters)
    const id = nanoid(12);

    const now = Date.now();
    const memory: Memory = {
      content: validatedInput.content,
      createdAt: now,
      id,
      metadata: validatedInput.metadata,
      tags: validatedInput.tags,
      updatedAt: now,
    };

    // Validate the complete memory object
    const validatedMemory = MemorySchema.parse(memory);

    try {
      await this.storage.save(validatedMemory);
      console.log(`Created memory: ${id}`);
      return validatedMemory;
    } catch (error) {
      throw MemoryError.storageError(
        `Failed to store memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Delete a memory by ID
   * @param id - Memory ID to delete
   * @throws MemoryError if ID is invalid or memory not found
   */
  async delete(id: string): Promise<void> {
    if (!id || typeof id !== 'string') {
      throw MemoryError.invalidId(id);
    }

    // Verify memory exists before deleting
    await this.get(id);

    try {
      await this.storage.delete(id);
      console.log(`Deleted memory: ${id}`);
    } catch (error) {
      throw MemoryError.deleteError(
        `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Get a memory by ID
   * @param id - Memory ID to retrieve
   * @returns Memory object
   * @throws MemoryError if ID is invalid or memory not found
   */
  async get(id: string): Promise<Memory> {
    if (!id || typeof id !== 'string') {
      throw MemoryError.invalidId(id);
    }

    try {
      const memory = await this.storage.get(id);
      if (!memory) {
        throw MemoryError.notFound(id);
      }

      return memory;
    } catch (error) {
      if (
        error instanceof MemoryError &&
        error.code === MemoryErrorCode.MEMORY_NOT_FOUND
      ) {
        throw error;
      }

      throw MemoryError.retrievalError(
        `Failed to retrieve memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Check if a memory exists
   * @param id - Memory ID to check
   * @returns true if memory exists, false otherwise
   */
  async has(id: string): Promise<boolean> {
    try {
      await this.get(id);
      return true;
    } catch (error) {
      if (
        error instanceof MemoryError &&
        error.code === MemoryErrorCode.MEMORY_NOT_FOUND
      ) {
        return false;
      }

      throw error;
    }
  }

  /**
   * List all memories with optional filtering, sorting, and pagination
   * @param options - Query options for filtering and pagination
   * @returns Array of memories matching the criteria
   */
  async list(options: ListMemoriesOptions = {}): Promise<Memory[]> {
    // Validate and parse options
    const validatedOptions = ListMemoriesOptionsSchema.parse(options);

    try {
      // Load all memories from storage
      const memories = await this.storage.loadAll();

      // Apply filters
      let filtered = memories;

      // Filter by tags (OR logic - match any of the provided tags)
      if (validatedOptions.tags && validatedOptions.tags.length > 0) {
        filtered = filtered.filter((m) =>
          m.tags?.some((tag) => validatedOptions.tags!.includes(tag)),
        );
      }

      // Filter by source
      if (validatedOptions.source) {
        filtered = filtered.filter((m) => m.metadata?.source === validatedOptions.source);
      }

      // Filter by pinned status
      if (validatedOptions.pinned !== undefined) {
        filtered = filtered.filter((m) => m.metadata?.pinned === validatedOptions.pinned);
      }

      // Sort by updatedAt descending (most recent first)
      filtered.sort((a, b) => b.updatedAt - a.updatedAt);

      // Apply pagination
      if (validatedOptions.offset !== undefined || validatedOptions.limit !== undefined) {
        const start = validatedOptions.offset ?? 0;
        const end = validatedOptions.limit ? start + validatedOptions.limit : undefined;
        filtered = filtered.slice(start, end);
      }

      return filtered;
    } catch (error) {
      throw MemoryError.retrievalError(
        `Failed to list memories: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Update an existing memory
   * @param id - Memory ID to update
   * @param input - Update input (partial)
   * @returns Updated memory
   * @throws MemoryError if ID is invalid or memory not found
   */
  async update(id: string, input: UpdateMemoryInput): Promise<Memory> {
    if (!id || typeof id !== 'string') {
      throw MemoryError.invalidId(id);
    }

    // Validate input
    const validatedInput = UpdateMemoryInputSchema.parse(input);

    // Get existing memory
    const existing = await this.get(id);

    // Merge updates
    const updated: Memory = {
      ...existing,
      content:
        validatedInput.content === undefined ? existing.content : validatedInput.content,
      tags: validatedInput.tags === undefined ? existing.tags : validatedInput.tags,
      updatedAt: Date.now(),
    };

    // Merge metadata if provided
    if (validatedInput.metadata) {
      updated.metadata = {
        ...existing.metadata,
        ...validatedInput.metadata,
      };
    }

    // Validate the updated memory
    const validatedMemory = MemorySchema.parse(updated);

    try {
      await this.storage.save(validatedMemory);
      console.log(`Updated memory: ${id}`);
      return validatedMemory;
    } catch (error) {
      throw MemoryError.storageError(
        `Failed to update memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
