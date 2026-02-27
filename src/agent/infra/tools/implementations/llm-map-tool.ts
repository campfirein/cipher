import type {Tool, ToolExecutionContext, ToolMetadata} from '../../../core/domain/tools/types.js'
import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'

import {executeLlmMap} from '../../map/llm-map-service.js'
import {LlmMapParametersSchema} from '../../map/map-shared.js'

/**
 * Create the llm_map tool.
 *
 * Runs a parallel, non-agentic map over a JSONL file. For each item (line),
 * makes a single LLM API call (no tools, no file I/O, no code execution)
 * that must return one JSON value conforming to the provided output schema.
 *
 * Best for high-throughput, side-effect-free tasks (classification, scoring,
 * extraction, summarization) where the full context can be included in the
 * prompt and item JSON.
 *
 * @param generator - IContentGenerator for LLM calls
 * @param workingDirectory - Project root directory
 */
export function createLlmMapTool(
  generator: IContentGenerator,
  workingDirectory: string,
): Tool {
  return {
    description: [
      'Run a parallel, non-agentic map over a JSONL file.',
      'For each item (line), make a single LLM API call (no tools, no file I/O)',
      'that must return one JSON value conforming to the provided output schema.',
      '',
      'Best for high-throughput, side-effect-free tasks:',
      '- Classification and scoring',
      '- Data extraction and transformation',
      '- Summarization',
      '- Content analysis',
      '',
      'Each item is processed in complete isolation — the LLM cannot see other items.',
      'If per-item processing requires file reads or tool access, use agentic_map instead.',
      '',
      'Input: JSONL file (one JSON object per line)',
      'Output: JSONL file with one result per line, ordered by input line.',
    ].join('\n'),

    async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
      const params = LlmMapParametersSchema.parse(input)

      const result = await executeLlmMap({
        abortSignal: context?.signal,
        generator,
        onProgress: context?.metadata
          ? (progress) => {
              context.metadata!({
                description: `Processing items: ${progress.succeeded + progress.failed}/${progress.total} (${progress.succeeded} ok, ${progress.failed} failed)`,
                progress: Math.round(((progress.succeeded + progress.failed) / Math.max(progress.total, 1)) * 100),
              })
            }
          : undefined,
        params,
        taskId: context?.taskId,
        workingDirectory,
      })

      return {
        failed: result.failed,
        mapId: result.mapId,
        outputPath: params.output_path,
        succeeded: result.succeeded,
        total: result.total,
      }
    },

    getMetadata(args: Record<string, unknown>): ToolMetadata {
      return {
        affectedLocations: [args.output_path as string],
        category: 'execute',
        riskLevel: 'low',
      }
    },

    id: 'llm_map',
    inputSchema: LlmMapParametersSchema,
  }
}
