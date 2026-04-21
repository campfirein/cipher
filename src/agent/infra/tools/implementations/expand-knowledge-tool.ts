import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

import type {IRuntimeSignalStore} from '../../../../server/core/interfaces/storage/i-runtime-signal-store.js'
import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../server/constants.js'
import {FileContextTreeArchiveService} from '../../../../server/infra/context-tree/file-context-tree-archive-service.js'
import {estimateTokens} from '../../../../server/infra/executor/pre-compaction/compaction-escalation.js'
import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for expand knowledge tool.
 * Accepts either a stubPath (archive drill-down) or an overviewPath (L1 overview retrieval).
 */
const ExpandKnowledgeInputSchema = z
  .object({
    overviewPath: z
      .string()
      .min(1)
      .describe(
        'Path to the .overview.md file (relative to context tree). ' +
        'This is the `overviewPath` field from search results.',
      )
      .optional(),
    stubPath: z
      .string()
      .min(1)
      .describe(
        'Path to the .stub.md file in _archived/. ' +
        'This is the `path` field from search results where symbolKind === "archive_stub".',
      )
      .optional(),
  })
  .refine(
    (data) => (data.stubPath !== undefined) !== (data.overviewPath !== undefined),
    {message: 'Exactly one of stubPath or overviewPath must be provided'},
  )

/**
 * Configuration for expand knowledge tool.
 */
export interface ExpandKnowledgeToolConfig {
  baseDirectory?: string
  runtimeSignalStore?: IRuntimeSignalStore
}

/**
 * Creates the expand knowledge tool.
 *
 * Two modes:
 * - stubPath: retrieves full content from archived knowledge entries (archive drill-down)
 * - overviewPath: retrieves L1 overview content from .overview.md sibling files
 *
 * @param config - Optional configuration
 * @returns Configured expand knowledge tool
 */
export function createExpandKnowledgeTool(config: ExpandKnowledgeToolConfig = {}): Tool {
  const archiveService = new FileContextTreeArchiveService(config.runtimeSignalStore)

  return {
    description:
      'Retrieve full content from archived knowledge entries or L1 overview files. ' +
      'Use stubPath when search results include an archive_stub that you need to drill into. ' +
      'Use overviewPath to retrieve the structured overview for a context entry.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const parsed = ExpandKnowledgeInputSchema.parse(input)

      if (parsed.overviewPath) {
        const baseDir = config.baseDirectory ?? process.cwd()
        const fullPath = join(baseDir, BRV_DIR, CONTEXT_TREE_DIR, parsed.overviewPath)
        const overviewContent = await readFile(fullPath, 'utf8')
        const originalPath = parsed.overviewPath.replace(/\.overview\.md$/, '.md')
        return {
          originalPath,
          overviewContent,
          tokenCount: estimateTokens(overviewContent),
        }
      }

      if (!parsed.stubPath) {
        throw new Error('stubPath is required when overviewPath is not provided')
      }

      const result = await archiveService.drillDown(parsed.stubPath, config.baseDirectory)
      return {
        fullContent: result.fullContent,
        originalPath: result.originalPath,
        tokenCount: result.tokenCount,
      }
    },
    id: ToolName.EXPAND_KNOWLEDGE,
    inputSchema: ExpandKnowledgeInputSchema,
  }
}
