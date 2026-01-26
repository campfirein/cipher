import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {ToolProviderGetter} from '../tool-provider-getter.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Tools that are not allowed in batch execution.
 * - batch: No nesting of batch calls
 * - edit_file: Sequential edits for proper conflict handling
 * - write_todos: Lightweight, call directly
 */
const DISALLOWED_TOOLS = new Set(['batch', 'edit_file', 'write_todos'])

/**
 * Maximum number of tool calls allowed in a single batch.
 */
const MAX_BATCH_SIZE = 10

/**
 * Input schema for batch tool.
 */
const BatchInputSchema = z
  .object({
    /**
     * Array of tool calls to execute in parallel.
     */
    toolCalls: z
      .array(
        z.object({
          /**
           * Parameters for the tool.
           */
          parameters: z.record(z.unknown()).describe('Parameters for the tool'),

          /**
           * The name of the tool to execute.
           */
          tool: z.string().describe('The name of the tool to execute'),
        }),
      )
      .min(1, 'Provide at least one tool call')
      .describe('Array of tool calls to execute in parallel'),
  })
  .strict()

/**
 * Input type for batch tool.
 */
type BatchInput = z.infer<typeof BatchInputSchema>

/**
 * Result of a single tool call within a batch.
 */
interface BatchCallResult {
  /** Duration of the call in milliseconds */
  durationMs: number

  /** Error message if the call failed */
  error?: string

  /** Result of the tool execution if successful */
  result?: unknown

  /** Whether the call succeeded */
  success: boolean

  /** Name of the tool that was called */
  tool: string
}

/**
 * Create batch tool.
 *
 * Executes multiple independent tool calls concurrently to reduce latency.
 * Best used for gathering context (reads, searches, listings).
 *
 * @param getToolProvider - Lazy getter for tool provider (avoids circular dependency)
 * @returns batch tool instance
 */
export function createBatchTool(getToolProvider: ToolProviderGetter): Tool {
  return {
    description: 'Execute multiple independent tool calls concurrently.',

    async execute(input: unknown, context?: ToolExecutionContext) {
      const {toolCalls} = input as BatchInput
      const toolProvider = getToolProvider()

      // Limit to MAX_BATCH_SIZE
      const activeCalls = toolCalls.slice(0, MAX_BATCH_SIZE)
      const discardedCalls = toolCalls.slice(MAX_BATCH_SIZE)

      /**
       * Execute a single tool call and return the result.
       */
      const executeCall = async (call: {
        parameters: Record<string, unknown>
        tool: string
      }): Promise<BatchCallResult> => {
        const startTime = Date.now()

        // Check if tool is disallowed in batch
        if (DISALLOWED_TOOLS.has(call.tool)) {
          return {
            durationMs: Date.now() - startTime,
            error: `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${[...DISALLOWED_TOOLS].join(', ')}`,
            success: false,
            tool: call.tool,
          }
        }

        // Check if tool exists
        if (!toolProvider.hasTool(call.tool)) {
          const availableTools = toolProvider.getToolNames().filter((name) => !DISALLOWED_TOOLS.has(name))
          return {
            durationMs: Date.now() - startTime,
            error: `Tool '${call.tool}' not found. Available tools: ${availableTools.join(', ')}`,
            success: false,
            tool: call.tool,
          }
        }

        try {
          const result = await toolProvider.executeTool(call.tool, call.parameters, context?.sessionId, context)
          return {
            durationMs: Date.now() - startTime,
            result,
            success: true,
            tool: call.tool,
          }
        } catch (error) {
          return {
            durationMs: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error),
            success: false,
            tool: call.tool,
          }
        }
      }

      // Execute all calls in parallel
      const results = await Promise.all(activeCalls.map((call) => executeCall(call)))

      // Add discarded calls as errors
      for (const call of discardedCalls) {
        results.push({
          durationMs: 0,
          error: `Maximum of ${MAX_BATCH_SIZE} tools allowed in batch`,
          success: false,
          tool: call.tool,
        })
      }

      const successful = results.filter((r) => r.success).length
      const failed = results.length - successful

      // Stream progress update
      if (context?.metadata) {
        context.metadata({
          description: 'Batch execution complete',
          output: `${successful}/${results.length} tools executed successfully`,
          progress: 100,
        })
      }

      // Build output message
      const outputMessage =
        failed > 0
          ? `Executed ${successful}/${results.length} tools successfully. ${failed} failed.`
          : `All ${successful} tools executed successfully.\n\nKeep using the batch tool for optimal performance!`

      return {
        metadata: {
          details: results.map((r) => ({success: r.success, tool: r.tool})),
          failed,
          successful,
          tools: toolCalls.map((c) => c.tool),
          totalCalls: results.length,
        },
        results: results.map((r) => ({
          durationMs: r.durationMs,
          success: r.success,
          tool: r.tool,
          ...(r.success ? {result: r.result} : {error: r.error}),
        })),
        summary: outputMessage,
      }
    },

    id: ToolName.BATCH,
    inputSchema: BatchInputSchema,
  }
}
