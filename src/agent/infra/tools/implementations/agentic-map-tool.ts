import type {ICipherAgent} from '../../../core/interfaces/i-cipher-agent.js'
import type {Tool, ToolExecutionContext, ToolMetadata} from '../../../core/domain/tools/types.js'

import {AgenticMapParametersSchema} from '../../map/map-shared.js'
import {executeAgenticMap} from '../../map/agentic-map-service.js'

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
 */
export function createAgenticMapTool(
  agent: ICipherAgent,
  workingDirectory: string,
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
    ].join('\n'),

    async execute(input: unknown, context?: ToolExecutionContext): Promise<unknown> {
      const params = AgenticMapParametersSchema.parse(input)

      const result = await executeAgenticMap({
        abortSignal: context?.signal,
        agent,
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
        riskLevel: 'medium',
      }
    },

    id: 'agentic_map',
    inputSchema: AgenticMapParametersSchema,
  }
}
