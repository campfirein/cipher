import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {MemoryManager} from '../../memory/memory-manager.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for list memories tool.
 */
const ListMemoriesInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of memories to return'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Number of memories to skip (for pagination)'),
    pinned: z.boolean().optional().describe('Filter by pinned status'),
    source: z
      .enum(['agent', 'system', 'user'])
      .optional()
      .describe('Filter by source (default: agent)'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type ListMemoriesInput = z.infer<typeof ListMemoriesInputSchema>

/**
 * Creates the list memories tool.
 *
 * Lists and filters memories stored in the scratch pad. Supports filtering by
 * tags, pinned status, and source. Results are sorted by most recently updated first.
 *
 * @param memoryManager - Memory manager service dependency
 * @returns Configured list memories tool
 */
export function createListMemoriesTool(memoryManager: MemoryManager): Tool {
  return {
    description:
      'List and filter memories from the scratch pad. Returns memories sorted by most recent first. Use this to discover what context has been stored.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {limit, offset, pinned, source} = input as ListMemoriesInput

      // List memories with filters
      const memories = await memoryManager.list({
        limit,
        offset,
        pinned, 
        source,
      })

      // Return formatted result with preview
      return {
        count: memories.length,
        memories: memories.map(m => ({
          contentPreview:
            m.content.length > 200 ? `${m.content.slice(0, 200)}...` : m.content,
          createdAt: new Date(m.createdAt).toISOString(),
          id: m.id,
          pinned: m.metadata?.pinned ?? false,
          updatedAt: new Date(m.updatedAt).toISOString(),
        })),
      }
    },
    id: ToolName.LIST_MEMORIES,
    inputSchema: ListMemoriesInputSchema,
  }
}
