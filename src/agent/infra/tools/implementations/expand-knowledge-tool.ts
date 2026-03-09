import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'

import {FileContextTreeArchiveService} from '../../../../server/infra/context-tree/file-context-tree-archive-service.js'
import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for expand knowledge tool.
 */
const ExpandKnowledgeInputSchema = z
  .object({
    stubPath: z
      .string()
      .min(1)
      .describe(
        'Path to the .stub.md file in _archived/. ' +
        'This is the `path` field from search results where symbolKind === "archive_stub".',
      ),
  })
  .strict()

/**
 * Configuration for expand knowledge tool.
 */
export interface ExpandKnowledgeToolConfig {
  baseDirectory?: string
}

/**
 * Creates the expand knowledge tool.
 *
 * Retrieves full content from archived knowledge entries by reading the
 * lossless .full.md file that the stub points to. No LLM call needed —
 * purely file-based lookup.
 *
 * @param config - Optional configuration
 * @returns Configured expand knowledge tool
 */
export function createExpandKnowledgeTool(config: ExpandKnowledgeToolConfig = {}): Tool {
  const archiveService = new FileContextTreeArchiveService()

  return {
    description:
      'Retrieve full content from archived knowledge entries. ' +
      'Use when search results include an archive_stub that you need to drill into.',
    async execute(input: unknown, _context?: ToolExecutionContext) {
      const parsed = ExpandKnowledgeInputSchema.parse(input)
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
