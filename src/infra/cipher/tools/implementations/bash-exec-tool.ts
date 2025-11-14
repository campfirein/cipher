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
     * Timeout in milliseconds (max: 600000).
     */
    timeout: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .default(120_000)
      .describe('Timeout in milliseconds'),
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
 *
 * @param processService - Process service for command execution
 * @returns bash_exec tool instance
 */
export function createBashExecTool(processService: IProcessService): Tool {
  return {
    description: `Execute shell commands with security validation and working directory confinement.

Features:
- Foreground execution: Waits for command to complete and returns output
- Background execution: Returns immediately with process ID for later retrieval
- Security validation: Blocks dangerous patterns (rm -rf /, fork bombs, etc.)
- Timeout management: Automatically terminates long-running commands
- Working directory confinement: All commands confined to configured base directory

Security model:
- Commands are confined to the working directory (cannot escape via path traversal)
- Truly dangerous patterns are blocked (rm -rf /, format commands, fork bombs)
- No approval system - agent operates autonomously within confined environment

Best practices:
- All file operations are automatically confined to the working directory
- Use background execution for long-running commands (>30 seconds)
- Monitor process output and handle errors gracefully
- Clean up background processes when no longer needed`,

    async execute(input: unknown, _context?: ToolExecutionContext) {
      const {command, cwd, description, runInBackground, timeout} = input as BashExecInput

      // Execute command via process service
      const result = await processService.executeCommand(command, {
        cwd,
        description,
        runInBackground,
        timeout,
      })

      // Return based on execution mode
      if ('stdout' in result) {
        // Foreground execution result
        return {
          duration: result.duration,
          exitCode: result.exitCode,
          stderr: result.stderr,
          stdout: result.stdout,
        }
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
