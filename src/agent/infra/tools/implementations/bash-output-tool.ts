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
    description: `Retrieve output from a background process started by bash_exec.`,

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
