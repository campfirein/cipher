import type {Tool, ToolExecutionContext, ToolMetadata} from '../../../core/domain/tools/types.js'
import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'
import type {ILogger} from '../../../core/interfaces/i-logger.js'
import type {ITokenizer} from '../../../core/interfaces/i-tokenizer.js'

import {ContextTreeStore} from '../../map/context-tree-store.js'
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
 * @param options - Optional dependencies for ContextTreeStore
 */
export function createLlmMapTool(
  generator: IContentGenerator,
  workingDirectory: string,
  options?: {
    logger?: ILogger
    maxContextTokens?: number
    tokenizer?: ITokenizer
  },
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
      '',
      'Results include an optional summaryHandle — a compact summary of processed items.',
      'The JSONL output file is always the source of truth for per-item results.',
    ].join('\n'),

    async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
      const params = LlmMapParametersSchema.parse(input)

      // Construct ContextTreeStore if tokenizer available
      const contextTreeStore = options?.tokenizer
        ? new ContextTreeStore({
            generator,
            tauHard: Math.floor((options.maxContextTokens ?? 100_000) * 0.5),
            tokenizer: options.tokenizer,
          })
        : undefined

      const result = await executeLlmMap({
        abortSignal: context?.signal,
        contextTreeStore,
        generator,
        logger: options?.logger,
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
        ...(result.summaryHandle && {summaryHandle: result.summaryHandle}),
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
