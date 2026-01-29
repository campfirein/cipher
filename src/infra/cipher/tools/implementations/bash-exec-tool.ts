import {z} from 'zod'

import type {Tool, ToolExecutionContext} from '../../../../core/domain/cipher/tools/types.js'
import type {IProcessService} from '../../../../core/interfaces/cipher/i-process-service.js'

import {ToolName} from '../../../../core/domain/cipher/tools/constants.js'

/**
 * Input schema for bash_exec tool.
 */
const BashExecInputSchema = z
  .object({
    /**
     * Shell command to execute.
     */
    command: z.string().describe('Shell command to execute'),

    /**
     * Working directory for command execution (relative to configured base directory).
     */
    cwd: z.string().optional().describe('Working directory for command execution'),

    /**
     * Human-readable description of what the command does (5-10 words).
     */
    description: z.string().optional().describe('Description of what the command does (5-10 words)'),

    /**
     * Execute command in background (returns immediately with process handle).
     */
    runInBackground: z
      .boolean()
      .optional()
      .default(false)
      .describe('Execute command in background'),

    /**
     * Timeout in milliseconds (max: 600000, default: 300000 = 5 minutes).
     */
    timeout: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .default(300_000)
      .describe('Timeout in milliseconds (default: 5 minutes)'),
  })
  .strict()

/**
 * Input type for bash_exec tool.
 */
type BashExecInput = z.infer<typeof BashExecInputSchema>

/**
 * Create bash_exec tool.
 *
 * Executes shell commands with security validation and approval for dangerous commands.
 * Supports both foreground (wait for completion) and background (return immediately) execution.
 * When a metadata callback is provided, streams output updates in real-time.
 *
 * @param processService - Process service for command execution
 * @returns bash_exec tool instance
 */
export function createBashExecTool(processService: IProcessService): Tool {
  return {
    description: `Execute a shell command and return its output.`,

    async execute(input: unknown, context?: ToolExecutionContext) {
      const {command, cwd, description, runInBackground, timeout} = input as BashExecInput

      // Stream initial status via metadata callback if available
      if (context?.metadata) {
        context.metadata({
          description: description ?? `Executing: ${command.slice(0, 50)}${command.length > 50 ? '...' : ''}`,
          output: '',
          progress: 0,
        })
      }

      // Execute command via process service
      const result = await processService.executeCommand(command, {
        cwd,
        description,
        runInBackground,
        timeout,
      })

      // Return based on execution mode
      if ('stdout' in result) {
        // Stream final output via metadata callback if available
        if (context?.metadata) {
          context.metadata({
            description: description ?? 'Command completed',
            output: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''),
            progress: 100,
          })
        }

        // Foreground execution result
        return {
          duration: result.duration,
          exitCode: result.exitCode,
          stderr: result.stderr,
          stdout: result.stdout,
        }
      }

      // Stream background process info via metadata callback if available
      if (context?.metadata) {
        context.metadata({
          description: `Background process started: ${result.processId}`,
          output: `Process started with PID ${result.pid}`,
          progress: 100,
        })
      }

      // Background execution handle
      return {
        command: result.command,
        description: result.description,
        message: `Process started in background. Use bash_output with processId="${result.processId}" to retrieve output.`,
        pid: result.pid,
        processId: result.processId,
        startedAt: result.startedAt.toISOString(),
      }
    },

    id: ToolName.BASH_EXEC,
    inputSchema: BashExecInputSchema,
  }
}
