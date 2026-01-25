import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../types/tools/types.js'
import type {MemoryManager} from '../../memory/memory-manager.js'

import {ToolName} from '../../types/tools/constants.js'

/**
 * Input schema for write memory tool.
 */
const WriteMemoryInputSchema = z
  .object({
    content: z
      .string()
      .min(1, 'Memory content cannot be empty')
      .max(10_000, 'Memory content cannot exceed 10,000 characters')
      .describe('The content to store in memory'),
    pinned: z
      .boolean()
      .optional()
      .describe('Whether to pin this memory for auto-loading (default: false)'),
  })
  .strict()

/**
 * Input type derived from schema.
 */
type WriteMemoryInput = z.infer<typeof WriteMemoryInputSchema>

/**
 * Creates the write memory tool.
 *
 * Stores content in the agent's memory as a scratch pad for maintaining context
 * across tool invocations. Memories persist across sessions and can be tagged
 * for organization.
 *
 * @param memoryManager - Memory manager service dependency
 * @returns Configured write memory tool
 */
export function createWriteMemoryTool(memoryManager: MemoryManager): Tool {
  return {
    description:
      'Write content to agent memory as a scratch pad. Use this to store intermediate results, findings, or context that should persist across tool calls. Memories can be tagged and pinned for easy retrieval.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {content, pinned} = input as WriteMemoryInput

      // Create memory with agent source
      const memory = await memoryManager.create({
        content,
        metadata: {
          pinned: pinned ?? false,
          source: 'agent',
        },
      })

      // Return formatted result
      return {
        content: memory.content,
        createdAt: new Date(memory.createdAt).toISOString(),
        id: memory.id,
      }
    },
    id: ToolName.WRITE_MEMORY,
    inputSchema: WriteMemoryInputSchema,
  }
}
