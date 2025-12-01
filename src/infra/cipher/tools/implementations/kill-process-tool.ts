import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {IProcessService} from '../../../../core/interfaces/cipher/i-process-service.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for kill_process tool.
 */
const KillProcessInputSchema = z
  .object({
    /**
     * Unique process identifier from bash_exec.
     */
    processId: z.string().describe('Unique process identifier from bash_exec'),
  })
  .strict()

/**
 * Input type for kill_process tool.
 */
type KillProcessInput = z.infer<typeof KillProcessInputSchema>

/**
 * Create kill_process tool.
 *
 * Terminates a background process started by bash_exec.
 * Uses graceful shutdown (SIGTERM) with escalation to SIGKILL after 5 seconds.
 *
 * @param processService - Process service for killing processes
 * @returns kill_process tool instance
 */
export function createKillProcessTool(processService: IProcessService): Tool {
  return {
    description: `Terminate a background process started by bash_exec.

Features:
- Graceful shutdown: Sends SIGTERM first to allow cleanup
- Force kill: Escalates to SIGKILL after 5 seconds if still running
- Idempotent: Safe to call on already-terminated processes

Signal handling:
1. Sends SIGTERM (allows process to cleanup gracefully)
2. Waits 5 seconds
3. Sends SIGKILL if process still running (force terminate)

Use cases:
- Stop long-running commands that are no longer needed
- Cancel background processes that are taking too long
- Clean up processes before starting new ones`,

    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {processId} = input as KillProcessInput

      // Kill process via process service
      await processService.killProcess(processId)

      // Return success confirmation
      return {
        message: `Process ${processId} terminated successfully`,
        processId,
        success: true,
      }
    },

    id: ToolName.KILL_PROCESS,
    inputSchema: KillProcessInputSchema,
  }
}
