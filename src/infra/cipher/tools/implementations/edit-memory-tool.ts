import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {MemoryManager} from '../../memory/memory-manager.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for edit memory tool.
 */
const EditMemoryInputSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(10_000, 'Memory content cannot exceed 10,000 characters')
      .optional()
      .describe('Updated content for the memory'),
    id: z.string().min(1).describe('Unique identifier of the memory to edit'),
    pinned: z.boolean().optional().describe('Updated pinned status'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type EditMemoryInput = z.infer<typeof EditMemoryInputSchema>

/**
 * Creates the edit memory tool.
 *
 * Updates an existing memory's content, tags, or pinned status. Metadata is merged
 * while content and tags are replaced if provided. Use this to refine or update
 * context in the scratch pad.
 *
 * @param memoryManager - Memory manager service dependency
 * @returns Configured edit memory tool
 */
export function createEditMemoryTool(memoryManager: MemoryManager): Tool {
  return {
    description:
      'Edit an existing memory. Update content, tags, or pinned status. Use this to refine or update previously stored context.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {content, id, pinned} = input as EditMemoryInput

      // Build update input
      const updateInput: {
        content?: string
        metadata?: {pinned?: boolean}
      } = {}

      if (content !== undefined) {
        updateInput.content = content
      }

      if (pinned !== undefined) {
        updateInput.metadata = {pinned}
      }

      // Update memory
      const updatedMemory = await memoryManager.update(id, updateInput)

      // Return formatted result
      return {
        content: updatedMemory.content,
        id: updatedMemory.id, 
        updatedAt: new Date(updatedMemory.updatedAt).toISOString(),
      }
    },
    id: ToolName.EDIT_MEMORY,
    inputSchema: EditMemoryInputSchema,
  }
}
