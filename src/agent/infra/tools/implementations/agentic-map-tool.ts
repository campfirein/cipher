import type {Tool, ToolExecutionContext, ToolMetadata} from '../../../core/domain/tools/types.js'
import type {ICipherAgent} from '../../../core/interfaces/i-cipher-agent.js'
import type {IContentGenerator} from '../../../core/interfaces/i-content-generator.js'
import type {ILogger} from '../../../core/interfaces/i-logger.js'
import type {ITokenizer} from '../../../core/interfaces/i-tokenizer.js'

import {executeAgenticMap} from '../../map/agentic-map-service.js'
import {ContextTreeStore} from '../../map/context-tree-store.js'
import {AgenticMapParametersSchema} from '../../map/map-shared.js'

/**
 * Create the agentic_map tool.
 *
 * Runs a parallel map over a JSONL file. For each item (line), spawns a
 * sub-agent that receives the prompt plus a standardized metadata block.
 * The sub-agent must output a JSON value that validates against the provided
 * output schema.
 *
 * Use this instead of llm_map when items need tool access (file reads,
 * code execution, knowledge search). Use llm_map when items don't need
 * tools — it's faster and cheaper.
 *
 * @param agent - The cipher agent for creating sub-sessions
 * @param workingDirectory - Project root directory
 * @param options - Optional dependencies for ContextTreeStore
 */
export function createAgenticMapTool(
  agent: ICipherAgent,
  workingDirectory: string,
  options?: {
    generator?: IContentGenerator
    logger?: ILogger
    maxContextTokens?: number
    tokenizer?: ITokenizer
  },
): Tool {
  return {
    description: [
      'Run a parallel map over a JSONL file using sub-agent sessions.',
      'For each item (line), spawn a sub-agent that receives your prompt',
      'plus a standardized metadata block containing the item.',
      'The sub-agent must output a JSON value conforming to the output schema.',
      '',
      'Each sub-agent has full tool access (read files, search, code execution)',
      'unless read_only is set to true (which disables write operations).',
      '',
      'Use this tool when items need tool access during processing.',
      'Use llm_map instead if items only need LLM intelligence — it is faster and cheaper.',
      '',
      'Concurrency is capped at 4 parallel sub-agents.',
      'Input: JSONL file (one JSON object per line)',
      'Output: JSONL file with one result per line, ordered by input line.',
      '',
      'Results include an optional summaryHandle — a compact summary of processed items.',
      'The JSONL output file is always the source of truth for per-item results.',
    ].join('\n'),

    async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
      const params = AgenticMapParametersSchema.parse(input)

      // Construct ContextTreeStore if both generator+tokenizer available
      const contextTreeStore = options?.generator && options?.tokenizer
        ? new ContextTreeStore({
            generator: options.generator,
            tauHard: Math.floor((options.maxContextTokens ?? 100_000) * 0.5),
            tokenizer: options.tokenizer,
          })
        : undefined

      const result = await executeAgenticMap({
        abortSignal: context?.signal,
        agent,
        contextTreeStore,
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
        riskLevel: 'medium',
      }
    },

    id: 'agentic_map',
    inputSchema: AgenticMapParametersSchema,
  }
}
