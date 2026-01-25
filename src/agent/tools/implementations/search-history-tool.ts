import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../types/tools/types.js'

import {ToolName} from '../../types/tools/constants.js'

/**
 * Input schema for search history tool.
 */
const SearchHistoryInputSchema = z
  .object({
    limit: z.number().optional().default(20).describe('Maximum number of results to return (default: 20)'),
    mode: z
      .enum(['messages', 'sessions'])
      .describe(
        'Search mode: "messages" searches for individual messages, "sessions" finds sessions containing the query',
      ),
    offset: z.number().optional().default(0).describe('Offset for pagination (default: 0)'),
    query: z.string().describe('The search query to find in conversation history'),
    role: z.enum(['user', 'assistant', 'system', 'tool']).optional().describe('Filter by message role (optional)'),
    sessionId: z.string().optional().describe('Limit search to a specific session (optional)'),
  })
  .strict()

/**
 * Creates the search history tool.
 *
 * NOTE: This is a stub implementation. SearchService is not yet implemented.
 * This tool will throw an error until the SearchService is available.
 *
 * @returns Configured search history tool (stub)
 */
export function createSearchHistoryTool(): Tool {
  return {
    description:
      'Search conversation history. Supports searching messages or sessions. Can filter by role and session.',
    async execute(_input: unknown, _context?: ToolExecutionContext) {
      // Stub implementation - SearchService not yet available
      throw new Error(
        'Search history tool is not yet implemented. This feature requires the SearchService which is not currently available.',
      )
    },
    id: ToolName.SEARCH_HISTORY,
    inputSchema: SearchHistoryInputSchema,
  }
}