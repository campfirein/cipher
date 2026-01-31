import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {ToolName} from '../../../core/domain/tools/constants.js'
import {SearchKnowledgeService} from './search-knowledge-service.js'

const SearchKnowledgeInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(10)
      .describe('Maximum number of results to return (default: 10)'),
    query: z.string().min(1).describe('Natural language query string to search for in the knowledge base'),
  })
  .strict()

/**
 * Configuration for search knowledge tool.
 */
export interface SearchKnowledgeToolConfig {
  baseDirectory?: string
  cacheTtlMs?: number
}

/**
 * Creates the search knowledge tool.
 *
 * Searches the curated knowledge base in .brv/context-tree/ for relevant topics.
 * Uses MiniSearch for full-text search with caching and indexing.
 *
 * @param fileSystem - File system service dependency
 * @param config - Optional configuration
 * @returns Configured search knowledge tool
 */
export function createSearchKnowledgeTool(fileSystem: IFileSystem, config: SearchKnowledgeToolConfig = {}): Tool {
  // Create the search service (manages its own state/caching)
  const service = new SearchKnowledgeService(fileSystem, config)

  return {
    description:
      'Search the curated knowledge base in .brv/context-tree/ for relevant topics. ' +
      'Use natural language queries to find knowledge about specific topics (e.g., "auth design", "API patterns"). ' +
      'Returns matching file paths, titles, and relevant excerpts.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {limit, query} = SearchKnowledgeInputSchema.parse(input)
      return service.search(query, {limit})
    },
    id: ToolName.SEARCH_KNOWLEDGE,
    inputSchema: SearchKnowledgeInputSchema,
  }
}
