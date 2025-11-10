import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../core/domain/tools/types.js'
import type {IProcessService} from '../../../core/interfaces/i-process-service.js'

import {ToolName} from '../../../core/domain/tools/constants.js'

/**
 * Input schema for bash_output tool.
 */
const BashOutputInputSchema = z
  .object({
    /**
     * Unique process identifier from bash_exec.
     */
    processId: z.string().describe('Unique process identifier from bash_exec'),
  })
  .strict()

/**
 * Input type for bash_output tool.
 */
type BashOutputInput = z.infer<typeof BashOutputInputSchema>

/**
 * Create bash_output tool.
 *
 * Retrieves output from a background process started by bash_exec.
 * Reading output clears the buffer (destructive read), so output is only returned once.
 *
 * @param processService - Process service for retrieving output
 * @returns bash_output tool instance
 */
export function createBashOutputTool(processService: IProcessService): Tool {
  return {
    description: `Retrieve output from a background process started by bash_exec.

Features:
- Returns new output since last read (incremental)
- Reading output clears the buffer (output returned only once)
- Shows process status (running/completed/failed)
- Includes exit code and duration when completed

Usage:
1. Start a background process with bash_exec (runInBackground: true)
2. Use the returned processId with this tool to retrieve output
3. Call repeatedly to get incremental output as process runs
4. Process automatically cleaned up 1 hour after completion

Note: Output is truncated if it exceeds buffer limit (default 1MB).`,

    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {processId} = input as BashOutputInput

      // Get output from process service
      const output = await processService.getProcessOutput(processId)

      // Return output with status
      return {
        duration: output.duration,
        exitCode: output.exitCode,
        processId,
        status: output.status,
        stderr: output.stderr,
        stdout: output.stdout,
      }
    },

    id: ToolName.BASH_OUTPUT,
    inputSchema: BashOutputInputSchema,
  }
}
