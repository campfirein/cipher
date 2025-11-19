import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {MemoryManager} from '../../memory/memory-manager.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for read memory tool.
 */
const ReadMemoryInputSchema = z
  .object({
    id: z.string().min(1).describe('Unique identifier of the memory to retrieve'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type ReadMemoryInput = z.infer<typeof ReadMemoryInputSchema>

/**
 * Read memory tool.
 *
 * Retrieves a specific memory by its ID. Use this to recall previously stored
 * context, intermediate results, or findings from the scratch pad.
 *
 * @param memoryManager - Memory manager service dependency
 * @returns Configured read memory tool
 */
export function createReadMemoryTool(memoryManager: MemoryManager): Tool {
  return {
    description:
      'Read a specific memory by ID. Use this to retrieve previously stored context, findings, or intermediate results from the scratch pad.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {id} = input as ReadMemoryInput

      // Retrieve memory
      const memory = await memoryManager.get(id)

      // Return formatted result
      return {
        content: memory.content,
        createdAt: new Date(memory.createdAt).toISOString(),
        id: memory.id,
        metadata: memory.metadata,
        updatedAt: new Date(memory.updatedAt).toISOString(),
      }
    },
    id: ToolName.READ_MEMORY,
    inputSchema: ReadMemoryInputSchema,
  }
}
