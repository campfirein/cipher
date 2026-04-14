import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {ISwarmCoordinator} from '../../../core/interfaces/i-swarm-coordinator.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

const SwarmStoreInputSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .describe('Knowledge content to store in a swarm provider'),
    contentType: z
      .enum(['entity', 'general', 'note'])
      .optional()
      .describe('Content type hint for routing: entity (people/companies), note (drafts/meetings), general'),
    provider: z
      .string()
      .optional()
      .describe('Explicit target provider ID (e.g., gbrain, local-markdown:notes). Auto-routed if omitted.'),
  })
  .strict()

/**
 * Creates the swarm_store tool for the agent to write knowledge to swarm providers.
 *
 * @param coordinator - The swarm coordinator instance
 * @returns Configured swarm store tool
 */
export function createSwarmStoreTool(coordinator: ISwarmCoordinator): Tool {
  return {
    description:
      'Store knowledge in a swarm provider (GBrain, local markdown). ' +
      'Routes by content type: entities (people, companies) go to GBrain, ' +
      'notes and drafts go to local markdown. Use the provider parameter to ' +
      'target a specific provider. Use the curate tool for project-specific ' +
      'knowledge that belongs in the context tree.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const parsed = SwarmStoreInputSchema.parse(input)

      return coordinator.store({
        content: parsed.content,
        contentType: parsed.contentType,
        provider: parsed.provider,
      })
    },
    id: ToolName.SWARM_STORE,
    inputSchema: SwarmStoreInputSchema,
  }
}
