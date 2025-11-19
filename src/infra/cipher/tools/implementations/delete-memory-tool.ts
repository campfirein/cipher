import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {MemoryManager} from '../../memory/memory-manager.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for delete memory tool.
 */
const DeleteMemoryInputSchema = z
  .object({
    id: z.string().min(1).describe('Unique identifier of the memory to delete'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type DeleteMemoryInput = z.infer<typeof DeleteMemoryInputSchema>

/**
 * Delete memory tool.
 *
 * Removes a memory from the scratch pad. Also deletes any blob attachments
 * associated with the memory. Use this to clean up outdated or unnecessary context.
 *
 * @param memoryManager - Memory manager service dependency
 * @returns Configured delete memory tool
 */
export function createDeleteMemoryTool(memoryManager: MemoryManager): Tool {
  return {
    description:
      'Delete a memory by ID. Removes the memory and all associated attachments from the scratch pad. Use this to clean up outdated context.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {id} = input as DeleteMemoryInput

      // Delete memory
      await memoryManager.delete(id)

      // Return confirmation
      return {
        deleted: true,
        id,
        message: `Memory ${id} has been deleted successfully`,
      }
    },
    id: ToolName.DELETE_MEMORY,
    inputSchema: DeleteMemoryInputSchema,
  }
}
