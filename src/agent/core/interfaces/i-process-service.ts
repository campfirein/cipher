import type {
  ExecuteOptions,
  ProcessConfig,
  ProcessHandle,
  ProcessInfo,
  ProcessOutput,
  ProcessResult,
} from '../domain/process/types.js'

/**
 * Process service interface.
 *
 * Provides secure command execution with foreground/background support,
 * security validation, and resource management.
 */
export interface IProcessService {
  /**
   * Clean up completed background processes.
   *
   * Removes processes that have been completed for more than 1 hour.
   */
  cleanup(): Promise<void>

  /**
   * Execute a shell command.
   *
   * Validates command security, handles approval if needed, and executes
   * either in foreground (waiting for completion) or background (returns immediately).
   *
   * @param command - Shell command to execute
   * @param options - Execution options (timeout, cwd, background, etc.)
   * @returns Process result (foreground) or process handle (background)
   * @throws ProcessError if validation fails, approval denied, or execution fails
   */
  executeCommand(
    command: string,
    options?: ExecuteOptions,
  ): Promise<ProcessHandle | ProcessResult>

  /**
   * Get the current process configuration.
   *
   * @returns Readonly configuration object
   */
  getConfig(): Readonly<ProcessConfig>

  /**
   * Get output from a background process.
   *
   * Retrieves new output since last read and clears the buffer (destructive read).
   *
   * @param processId - Unique process identifier
   * @returns Process output with status and exit code (if completed)
   * @throws ProcessError if process not found
   */
  getProcessOutput(processId: string): Promise<ProcessOutput>

  /**
   * Initialize the process service.
   *
   * Must be called before executing commands.
   * Performs cleanup of any stale processes from previous runs.
   */
  initialize(): Promise<void>

  /**
   * Terminate a background process.
   *
   * Sends SIGTERM, waits 5 seconds, then escalates to SIGKILL if still running.
   *
   * @param processId - Unique process identifier
   * @throws ProcessError if process not found or kill fails
   */
  killProcess(processId: string): Promise<void>

  /**
   * List all background processes.
   *
   * @returns Array of process information (status, timestamps, etc.)
   */
  listProcesses(): Promise<ProcessInfo[]>
}
