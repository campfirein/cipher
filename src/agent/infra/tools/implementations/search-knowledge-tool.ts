import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IFileSystem} from '../../../core/interfaces/i-file-system.js'

import {ToolName} from '../../../core/domain/tools/constants.js'
import {SearchKnowledgeService} from './search-knowledge-service.js'

const SearchKnowledgeInputSchema = z
  .object({
    excludeKinds: z
      .array(z.enum(['archive_stub', 'context', 'domain', 'subtopic', 'summary', 'topic']))
      .optional()
      .describe('Symbol kinds to exclude from results'),
    includeKinds: z
      .array(z.enum(['archive_stub', 'context', 'domain', 'subtopic', 'summary', 'topic']))
      .optional()
      .describe('Symbol kinds to include in results (filters out others)'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(10)
      .describe('Maximum number of results to return (default: 10)'),
    minMaturity: z
      .enum(['core', 'draft', 'validated'])
      .optional()
      .describe('Minimum maturity tier for results'),
    overview: z
      .boolean()
      .optional()
      .describe('If true, return tree structure overview instead of search results'),
    overviewDepth: z
      .number()
      .int()
      .min(0)
      .max(3)
      .optional()
      .default(2)
      .describe('Depth for overview mode (default: 2, showing domains + topics)'),
    query: z
      .string()
      .min(1)
      .describe(
        'Natural language query or symbolic path. ' +
        'Supports path queries like "auth/jwt" to navigate the knowledge hierarchy. ' +
        'Use "/" to scope searches (e.g., "auth/jwt refresh strategy" searches within auth/jwt).',
      ),
    scope: z
      .string()
      .optional()
      .describe('Path prefix to scope search within (e.g., "auth" or "auth/jwt-tokens")'),
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
 * Supports symbolic path queries, scoped search, kind/maturity filtering, and overview mode
 * in addition to full-text BM25 search.
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
      'Use natural language queries or symbolic paths (e.g., "auth/jwt", "/auth/jwt-tokens") ' +
      'to navigate the knowledge hierarchy. Supports scoped search, kind filtering, ' +
      'maturity filtering, and overview mode. Returns matching file paths, titles, excerpts, ' +
      'and symbolic metadata (kind, backlinks).',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const parsed = SearchKnowledgeInputSchema.parse(input)
      return service.search(parsed.query, {
        excludeKinds: parsed.excludeKinds,
        includeKinds: parsed.includeKinds,
        limit: parsed.limit,
        minMaturity: parsed.minMaturity,
        overview: parsed.overview,
        overviewDepth: parsed.overviewDepth,
        scope: parsed.scope,
      })
    },
    id: ToolName.SEARCH_KNOWLEDGE,
    inputSchema: SearchKnowledgeInputSchema,
  }
}
