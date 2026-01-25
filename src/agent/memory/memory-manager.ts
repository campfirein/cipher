import {nanoid} from 'nanoid'
import {z} from 'zod'

import type {StoredBlob} from '../types/blob/types.js'
import type {
  Attachment,
  CreateMemoryInput,
  ListMemoriesOptions,
  Memory,
  UpdateMemoryInput,
} from '../types/memory/types.js'
import type {IBlobStorage} from '../interfaces/i-blob-storage.js'
import type {ILogger} from '../interfaces/i-logger.js'

import {MemoryError, MemoryErrorCode} from '../types/errors/memory-error.js'
import {NoOpLogger} from '../interfaces/i-logger.js'

/**
 * Validation constants
 */
const MAX_CONTENT_LENGTH = 10_000 // 10k characters max per memory
const MAX_TAG_LENGTH = 50
const MAX_TAGS = 10

/**
 * Embedded Zod schemas for runtime validation
 * Following cipher pattern: schemas are co-located with implementation
 */
const MemorySourceSchema = z.enum(['agent', 'system', 'user']).describe('Source of the memory')

const AttachmentSchema = z
  .object({
    blobKey: z.string().min(1).describe('Reference to blob in BlobStorage'),
    createdAt: z.number().int().positive().describe('Timestamp when attached (Unix ms)'),
    name: z.string().optional().describe('Original filename'),
    size: z.number().int().nonnegative().describe('Size in bytes'),
    type: z.string().min(1).describe('MIME type'),
  })
  .strict()
  .describe('Blob attachment metadata')

const MemoryMetadataSchema = z
  .object({
    attachments: z.array(AttachmentSchema).optional().describe('Blob attachments'),
    pinned: z.boolean().optional().describe('Whether this memory is pinned for auto-loading'),
    source: MemorySourceSchema.optional().describe('Source of the memory'),
  })
  .passthrough() // Allow additional custom fields
  .describe('Memory metadata')

const MemorySchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(MAX_CONTENT_LENGTH, `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`)
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
  .describe('Memory item stored in the system')

const CreateMemoryInputSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(MAX_CONTENT_LENGTH, `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`)
      .describe('The memory content'),
    metadata: MemoryMetadataSchema.optional().describe('Optional metadata'),
    tags: z
      .array(z.string().min(1).max(MAX_TAG_LENGTH))
      .max(MAX_TAGS)
      .optional()
      .describe('Optional tags for categorization'),
  })
  .strict()
  .describe('Input for creating a new memory')

const UpdateMemoryInputSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(MAX_CONTENT_LENGTH, `Memory content cannot exceed ${MAX_CONTENT_LENGTH} characters`)
      .optional()
      .describe('Updated content'),
    metadata: MemoryMetadataSchema.optional().describe('Updated metadata (merges with existing)'),
  })
  .strict()
  .describe('Input for updating an existing memory')

const ListMemoriesOptionsSchema = z
  .object({
    limit: z.number().int().positive().optional().describe('Limit number of results'),
    offset: z.number().int().nonnegative().optional().describe('Skip first N results'),
    pinned: z.boolean().optional().describe('Filter by pinned status'),
    source: MemorySourceSchema.optional().describe('Filter by source'),
  })
  .strict()
  .describe('Options for listing memories')

/**
 * MemoryManager handles CRUD operations for cipher agent memories
 *
 * Responsibilities:
 * - Store and retrieve memories using BlobStorage
 * - Validate memory data using embedded Zod schemas
 * - Generate unique IDs for memories
 * - Filter and search memories by source and pinned status
 * - Sort memories by recency (updatedAt descending)
 * - Manage blob attachments
 *
 * Storage:
 * - Memories are stored as JSON blobs with key pattern: memory-{id}
 * - Attachments are stored as blobs with key pattern: memory-{id}-{suffix}
 * - All persistence operations use BlobStorage
 */
export class MemoryManager {
  private static readonly MEMORY_KEY_PREFIX = 'memory-'
  private readonly logger: ILogger

  constructor(private blobStorage: IBlobStorage, logger?: ILogger) {
    this.logger = logger ?? new NoOpLogger()
    this.logger.info('Memory manager initialized')
  }

  /**
   * Attach a blob to an existing memory
   * @param memoryId - Memory ID to attach blob to
   * @param content - Blob content (Buffer or string)
   * @param metadata - Blob metadata
   * @param metadata.name - Optional filename
   * @param metadata.type - Optional MIME type
   * @returns Attachment metadata
   * @throws MemoryError if memory not found or attachment fails
   */
  async attachBlob(
    memoryId: string,
    content: Buffer | string,
    metadata: {name?: string; type?: string} = {},
  ): Promise<Attachment> {
    // Get existing memory
    const memory = await this.get(memoryId)

    // Generate unique blob key
    const blobKey = `memory-${memoryId}-${nanoid(8)}`

    // Store blob
    try {
      const storedBlob = await this.blobStorage.store(blobKey, content, {
        contentType: metadata.type,
        originalName: metadata.name,
        tags: {memoryId},
      })

      // Create attachment metadata
      const attachment: Attachment = {
        blobKey,
        createdAt: Date.now(),
        name: metadata.name,
        size: storedBlob.metadata.size,
        type: storedBlob.metadata.contentType || 'application/octet-stream',
      }

      // Validate attachment
      const validatedAttachment = AttachmentSchema.parse(attachment)

      // Update memory metadata
      const updatedMemory: Memory = {
        ...memory,
        metadata: {
          ...memory.metadata,
          attachments: [
            ...(memory.metadata?.attachments && Array.isArray(memory.metadata.attachments)
              ? memory.metadata.attachments
              : []),
            validatedAttachment,
          ],
        },
        updatedAt: Date.now(),
      }

      // Save updated memory
      await this.saveMemory(updatedMemory)

      this.logger.debug('Attached blob to memory', {blobKey, memoryId})
      return validatedAttachment
    } catch (error) {
      // Cleanup: try to delete the blob if attachment failed
      try {
        await this.blobStorage.delete(blobKey)
      } catch {
        // Ignore cleanup errors
      }

      throw MemoryError.storageError(
        `Failed to attach blob: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Get count of total memories matching the filter criteria
   * @param options - Query options for filtering
   * @returns Number of memories matching the criteria
   */
  async count(options: ListMemoriesOptions = {}): Promise<number> {
    const memories = await this.list(options)
    return memories.length
  }

  /**
   * Create a new memory
   * @param input - Memory creation input
   * @returns Created memory with generated ID and timestamps
   */
  async create(input: CreateMemoryInput): Promise<Memory> {
    // Validate input
    const validatedInput = CreateMemoryInputSchema.parse(input)

    // Generate unique ID (12 characters)
    const id = nanoid(12)

    const now = Date.now()
    const memory: Memory = {
      content: validatedInput.content,
      createdAt: now,
      id,
      metadata: validatedInput.metadata,
      tags: validatedInput.tags,
      updatedAt: now,
    }

    // Validate the complete memory object
    const validatedMemory = MemorySchema.parse(memory)

    try {
      await this.saveMemory(validatedMemory)
      this.logger.debug('Created memory', {id})
      return validatedMemory
    } catch (error) {
      throw MemoryError.storageError(
        `Failed to store memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Delete a memory by ID
   * Also deletes all associated blob attachments
   * @param id - Memory ID to delete
   * @throws MemoryError if ID is invalid or memory not found
   */
  async delete(id: string): Promise<void> {
    if (!id || typeof id !== 'string') {
      throw MemoryError.invalidId(id)
    }

    // Get memory to find attachments
    const memory = await this.get(id)

    // Delete all blob attachments
    if (memory.metadata?.attachments && Array.isArray(memory.metadata.attachments)) {
      await Promise.allSettled(
        memory.metadata.attachments.map((att: Attachment) =>
          this.blobStorage.delete(att.blobKey).catch((error) => {
            this.logger.warn('Failed to delete blob', {blobKey: att.blobKey, error: error.message})
          }),
        ),
      )
    }

    // Delete the memory itself
    try {
      await this.deleteMemory(id)
      this.logger.debug('Deleted memory', {id})
    } catch (error) {
      throw MemoryError.deleteError(
        `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Detach (remove) a blob from a memory
   * @param memoryId - Memory ID to detach blob from
   * @param blobKey - Blob key to remove
   * @throws MemoryError if memory not found or detachment fails
   */
  async detachBlob(memoryId: string, blobKey: string): Promise<void> {
    // Get memory
    const memory = await this.get(memoryId)

    // Find attachment
    const attachments =
      memory.metadata?.attachments && Array.isArray(memory.metadata.attachments) ? memory.metadata.attachments : []
    const attachment = attachments.find((a: Attachment) => a.blobKey === blobKey)

    if (!attachment) {
      throw MemoryError.storageError(`Attachment not found: ${blobKey}`)
    }

    // Delete blob from storage
    try {
      await this.blobStorage.delete(blobKey)
    } catch (error) {
      this.logger.warn('Failed to delete blob', {
        blobKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Update memory metadata (remove attachment)
    const updatedMemory: Memory = {
      ...memory,
      metadata: {
        ...memory.metadata,
        attachments: attachments.filter((a: Attachment) => a.blobKey !== blobKey),
      },
      updatedAt: Date.now(),
    }

    // Save updated memory
    try {
      await this.saveMemory(updatedMemory)
      this.logger.debug('Detached blob from memory', {blobKey, memoryId})
    } catch (error) {
      throw MemoryError.storageError(
        `Failed to update memory after detaching blob: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
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
      throw MemoryError.invalidId(id)
    }

    try {
      const memory = await this.loadMemory(id)
      if (!memory) {
        throw MemoryError.notFound(id)
      }

      return memory
    } catch (error) {
      if (error instanceof MemoryError && error.code === MemoryErrorCode.MEMORY_NOT_FOUND) {
        throw error
      }

      throw MemoryError.retrievalError(
        `Failed to retrieve memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Get a blob attachment from a memory
   * @param memoryId - Memory ID
   * @param blobKey - Blob key to retrieve
   * @returns Stored blob with content and metadata
   * @throws MemoryError if memory not found or blob not found
   */
  async getAttachment(memoryId: string, blobKey: string): Promise<StoredBlob> {
    // Get memory to verify attachment exists
    const memory = await this.get(memoryId)
    const attachments =
      memory.metadata?.attachments && Array.isArray(memory.metadata.attachments) ? memory.metadata.attachments : []
    const attachment = attachments.find((a: Attachment) => a.blobKey === blobKey)

    if (!attachment) {
      throw MemoryError.storageError(`Attachment not found: ${blobKey}`)
    }

    // Retrieve blob
    try {
      const blob = await this.blobStorage.retrieve(blobKey)

      if (!blob) {
        throw MemoryError.retrievalError(`Failed to retrieve attachment: Blob ${blobKey} not found in storage`)
      }

      return blob
    } catch (error) {
      if (error instanceof MemoryError) {
        throw error
      }

      throw MemoryError.retrievalError(
        `Failed to retrieve attachment: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Check if a memory exists
   * @param id - Memory ID to check
   * @returns true if memory exists, false otherwise
   */
  async has(id: string): Promise<boolean> {
    try {
      await this.get(id)
      return true
    } catch (error) {
      if (error instanceof MemoryError && error.code === MemoryErrorCode.MEMORY_NOT_FOUND) {
        return false
      }

      throw error
    }
  }

  /**
   * List all memories with optional filtering, sorting, and pagination
   * @param options - Query options for filtering and pagination
   * @returns Array of memories matching the criteria
   */
  async list(options: ListMemoriesOptions = {}): Promise<Memory[]> {
    // Validate and parse options
    const validatedOptions = ListMemoriesOptionsSchema.parse(options)

    try {
      // Load all memories from blob storage
      const memories = await this.loadAllMemories()

      // Apply filters
      let filtered = memories

      // Filter by source
      if (validatedOptions.source) {
        filtered = filtered.filter((m: Memory) => m.metadata?.source === validatedOptions.source)
      }

      // Filter by pinned status
      if (validatedOptions.pinned !== undefined) {
        filtered = filtered.filter((m: Memory) => m.metadata?.pinned === validatedOptions.pinned)
      }

      // Sort by updatedAt descending (most recent first)
      filtered.sort((a: Memory, b: Memory) => b.updatedAt - a.updatedAt)

      // Apply pagination
      if (validatedOptions.offset !== undefined || validatedOptions.limit !== undefined) {
        const start = validatedOptions.offset ?? 0
        const end = validatedOptions.limit ? start + validatedOptions.limit : undefined
        filtered = filtered.slice(start, end)
      }

      return filtered
    } catch (error) {
      throw MemoryError.retrievalError(
        `Failed to list memories: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * List all attachments for a memory
   * @param memoryId - Memory ID
   * @returns Array of attachment metadata
   * @throws MemoryError if memory not found
   */
  async listAttachments(memoryId: string): Promise<Attachment[]> {
    const memory = await this.get(memoryId)
    const attachments = memory.metadata?.attachments

    if (!attachments || !Array.isArray(attachments)) {
      return []
    }

    return attachments as Attachment[]
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
      throw MemoryError.invalidId(id)
    }

    // Validate input
    const validatedInput = UpdateMemoryInputSchema.parse(input)

    // Get existing memory
    const existing = await this.get(id)

    // Merge updates
    const updated: Memory = {
      ...existing,
      content: validatedInput.content === undefined ? existing.content : validatedInput.content,
      updatedAt: Date.now(),
    }

    // Merge metadata if provided
    if (validatedInput.metadata) {
      updated.metadata = {
        ...existing.metadata,
        ...validatedInput.metadata,
      }
    }

    // Validate the updated memory
    const validatedMemory = MemorySchema.parse(updated)

    try {
      await this.saveMemory(validatedMemory)
      this.logger.debug('Updated memory', {id})
      return validatedMemory
    } catch (error) {
      throw MemoryError.storageError(
        `Failed to update memory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Delete a memory from blob storage
   */
  private async deleteMemory(id: string): Promise<void> {
    const key = this.getMemoryKey(id)
    await this.blobStorage.delete(key)
  }

  /**
   * Extract memory ID from blob key
   */
  private extractMemoryId(key: string): string {
    return key.replace(MemoryManager.MEMORY_KEY_PREFIX, '')
  }

  /**
   * Get the blob key for a memory
   */
  private getMemoryKey(id: string): string {
    return `${MemoryManager.MEMORY_KEY_PREFIX}${id}`
  }

  /**
   * Check if a blob key is a memory key (not an attachment)
   */
  private isMemoryKey(key: string): boolean {
    if (!key.startsWith(MemoryManager.MEMORY_KEY_PREFIX)) {
      return false
    }

    // Memory keys have format: memory-{id}
    // Attachment keys have format: memory-{id}-{suffix}
    // Count dashes: memory keys have 1 dash, attachments have 2+
    const dashCount = (key.match(/-/g) || []).length
    return dashCount === 1
  }

  /**
   * Load all memories from blob storage
   */
  private async loadAllMemories(): Promise<Memory[]> {
    const keys = await this.blobStorage.list(MemoryManager.MEMORY_KEY_PREFIX)

    // Filter to only memory keys (exclude attachments)
    const memoryKeys = keys.filter((key) => this.isMemoryKey(key))

    // Load all memories in parallel
    const memories = await Promise.all(
      memoryKeys.map(async (key) => {
        const id = this.extractMemoryId(key)
        return this.loadMemory(id)
      }),
    )

    // Filter out undefined values
    return memories.filter((m): m is Memory => m !== undefined)
  }

  /**
   * Load a memory from blob storage
   */
  private async loadMemory(id: string): Promise<Memory | undefined> {
    const key = this.getMemoryKey(id)
    const blob = await this.blobStorage.retrieve(key)

    if (!blob) {
      return undefined
    }

    try {
      const memory = JSON.parse(blob.content.toString('utf8')) as Memory
      return memory
    } catch (error) {
      throw MemoryError.retrievalError(
        `Failed to parse memory ${id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Save a memory to blob storage
   */
  private async saveMemory(memory: Memory): Promise<void> {
    const key = this.getMemoryKey(memory.id)
    const content = JSON.stringify(memory, null, 2)

    await this.blobStorage.store(key, content, {
      contentType: 'application/json',
      tags: {
        memoryId: memory.id,
        source: memory.metadata?.source || 'unknown',
      },
    })
  }
}
