import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {ISwarmCoordinator} from '../../../core/interfaces/i-swarm-coordinator.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

const SwarmQueryInputSchema = z
  .object({
    maxResults: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of results to return (default: 10)'),
    query: z
      .string()
      .min(1)
      .describe('Natural language query to search across all active memory providers'),
    scope: z
      .string()
      .optional()
      .describe('Optional scope to restrict search (e.g., "auth", "architecture")'),
  })
  .strict()

/**
 * Creates the swarm_query tool for the agent to search across memory providers.
 *
 * @param coordinator - The swarm coordinator instance
 * @returns Configured swarm query tool
 */
export function createSwarmQueryTool(coordinator: ISwarmCoordinator): Tool {
  return {
    description:
      'Search across all active memory providers in the memory swarm. ' +
      'Routes the query to relevant providers based on query type classification, ' +
      'executes in parallel, and returns fused, ranked results. ' +
      'Use this when you need information that may be spread across multiple knowledge sources.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const parsed = SwarmQueryInputSchema.parse(input)

      return coordinator.execute({
        maxResults: parsed.maxResults,
        query: parsed.query,
        scope: parsed.scope,
      })
    },
    id: ToolName.SWARM_QUERY,
    inputSchema: SwarmQueryInputSchema,
  }
}
