import type {ChildProcess} from 'node:child_process'

/**
 * Process execution configuration.
 *
 * Defines security settings, resource limits, and environment for command execution.
 */
export interface ProcessConfig {
  /**
   * Allowed commands whitelist (empty = all allowed with approval).
   */
  allowedCommands: string[]

  /**
   * Blocked commands blacklist.
   */
  blockedCommands: string[]

  /**
   * Custom environment variables for all commands.
   */
  environment: Record<string, string>

  /**
   * Maximum number of concurrent background processes.
   * @default 5
   */
  maxConcurrentProcesses: number

  /**
   * Maximum output buffer size per background process (bytes).
   * @default 1048576 (1MB)
   */
  maxOutputBuffer: number

  /**
   * Maximum timeout for any command (milliseconds).
   * @default 600000 (10 minutes)
   */
  maxTimeout: number

  /**
   * Security level for command validation.
   *
   * - `strict`: All commands require approval, blocks multiple commands unless safe
   * - `moderate`: Write operations require approval, dangerous patterns blocked
   * - `permissive`: Only dangerous patterns blocked, minimal approval
   *
   * @default 'moderate'
   */
  securityLevel: 'moderate' | 'permissive' | 'strict'

  /**
   * Base working directory for command execution.
   * All cwd options are confined within this directory.
   *
   * @default process.cwd()
   */
  workingDirectory?: string
}

/**
 * Options for executing a command.
 */
export interface ExecuteOptions {
  /**
   * Working directory for command execution (relative to ProcessConfig.workingDirectory).
   */
  cwd?: string

  /**
   * Human-readable description of what the command does (5-10 words).
   */
  description?: string

  /**
   * Custom environment variables for this command.
   */
  env?: Record<string, string>

  /**
   * Execute command in background (returns immediately with process handle).
   *
   * @default false
   */
  runInBackground?: boolean

  /**
   * Timeout in milliseconds (max: ProcessConfig.maxTimeout).
   *
   * @default 120000 (2 minutes)
   */
  timeout?: number
}

/**
 * Result of a foreground command execution.
 */
export interface ProcessResult {
  /**
   * Execution duration in milliseconds.
   */
  duration: number

  /**
   * Process exit code (0 = success).
   */
  exitCode: number

  /**
   * Standard error output.
   */
  stderr: string

  /**
   * Standard output.
   */
  stdout: string
}

/**
 * Handle for a background process.
 *
 * Returned immediately when executing a command in background.
 */
export interface ProcessHandle {
  /**
   * Command that was executed.
   */
  command: string

  /**
   * Optional description provided in ExecuteOptions.
   */
  description?: string

  /**
   * System process ID (may be undefined if process hasn't started).
   */
  pid?: number

  /**
   * Unique process identifier for tracking.
   */
  processId: string

  /**
   * Timestamp when process was started.
   */
  startedAt: Date
}

/**
 * Output from a background process.
 *
 * Returned by getProcessOutput(). Reading output clears the buffer.
 */
export interface ProcessOutput {
  /**
   * Execution duration in milliseconds (only available when completed).
   */
  duration?: number

  /**
   * Process exit code (only available when completed).
   */
  exitCode?: number

  /**
   * Process status.
   */
  status: 'completed' | 'failed' | 'running'

  /**
   * Standard error output (new since last read).
   */
  stderr: string

  /**
   * Standard output (new since last read).
   */
  stdout: string
}

/**
 * Information about a background process.
 *
 * Returned by listProcesses().
 */
export interface ProcessInfo {
  /**
   * Command that was executed.
   */
  command: string

  /**
   * Timestamp when process completed (if applicable).
   */
  completedAt?: Date

  /**
   * Optional description provided in ExecuteOptions.
   */
  description?: string

  /**
   * Process exit code (only available when completed).
   */
  exitCode?: number

  /**
   * System process ID.
   */
  pid?: number

  /**
   * Unique process identifier.
   */
  processId: string

  /**
   * Timestamp when process was started.
   */
  startedAt: Date

  /**
   * Process status.
   */
  status: 'completed' | 'failed' | 'running'
}

/**
 * Result of command validation.
 *
 * Returned by CommandValidator.validateCommand().
 */
export interface CommandValidation {
  /**
   * Error message if validation failed.
   */
  error?: string

  /**
   * Whether the command is valid and can be executed.
   */
  isValid: boolean

  /**
   * Normalized command string (trimmed, whitespace collapsed).
   */
  normalizedCommand?: string
}

/**
 * Output buffer for background process.
 *
 * Internal structure for tracking output with size limits.
 */
export interface OutputBuffer {
  /**
   * Running byte count for O(1) limit checking.
   */
  bytesUsed: number

  /**
   * Whether the process has finished execution.
   */
  complete: boolean

  /**
   * Timestamp of last read operation.
   */
  lastRead: number

  /**
   * Standard error chunks.
   */
  stderr: string[]

  /**
   * Standard output chunks.
   */
  stdout: string[]

  /**
   * Whether output was truncated due to buffer limits.
   */
  truncated?: boolean
}

/**
 * Internal tracking structure for background processes.
 *
 * Not exported - used internally by ProcessService.
 */
export interface BackgroundProcess {
  /**
   * Node.js child process instance.
   */
  child: ChildProcess

  /**
   * Command that was executed.
   */
  command: string

  /**
   * Timestamp when process completed.
   */
  completedAt?: Date

  /**
   * Optional description provided in ExecuteOptions.
   */
  description?: string

  /**
   * Process exit code (only available when completed).
   */
  exitCode?: number

  /**
   * Output buffer for collecting stdout/stderr.
   */
  outputBuffer: OutputBuffer

  /**
   * Unique process identifier.
   */
  processId: string

  /**
   * Timestamp when process was started.
   */
  startedAt: Date

  /**
   * Process status.
   */
  status: 'completed' | 'failed' | 'running'
}
