import {ProcessErrorCode} from './process-error-code.js'

/**
 * Base error class for process execution operations.
 *
 * All process-specific errors extend this base class.
 */
export class ProcessError extends Error {
  public readonly code: ProcessErrorCode
  public readonly details?: Record<string, unknown>
  public readonly suggestion?: string

  /**
   * Creates a new process error.
   *
   * @param message - Error message describing what went wrong
   * @param code - Error code for categorization
   * @param details - Additional error context
   * @param suggestion - Optional recovery suggestion
   */
  public constructor(
    message: string,
    code: ProcessErrorCode,
    details?: Record<string, unknown>,
    suggestion?: string,
  ) {
    super(message)
    this.name = 'ProcessError'
    this.code = code
    this.details = details
    this.suggestion = suggestion
  }

  /**
   * Factory method: Command matches blocked pattern.
   *
   * @param command - Command that was blocked
   * @param reason - Reason why command is blocked
   * @returns ProcessError instance
   */
  public static commandBlocked(command: string, reason: string): ProcessError {
    return new ProcessError(
      `Command blocked by security policy: ${command}. Reason: ${reason}`,
      ProcessErrorCode.COMMAND_BLOCKED,
      {command, reason},
      'Modify the command to avoid dangerous patterns or adjust security level.',
    )
  }

  /**
   * Factory method: Command injection detected.
   *
   * @param command - Command with injection pattern
   * @param pattern - Detected injection pattern
   * @returns ProcessError instance
   */
  public static commandInjection(command: string, pattern: string): ProcessError {
    return new ProcessError(
      `Command injection detected: ${command}. Pattern: ${pattern}`,
      ProcessErrorCode.INJECTION_DETECTED,
      {command, pattern},
      'Remove unsafe command chaining or substitution patterns.',
    )
  }

  /**
   * Factory method: Command not found in PATH.
   *
   * @param command - Command that was not found
   * @returns ProcessError instance
   */
  public static commandNotFound(command: string): ProcessError {
    const commandName = command.split(/\s+/)[0]
    return new ProcessError(
      `Command not found: ${commandName}`,
      ProcessErrorCode.COMMAND_NOT_FOUND,
      {command, commandName},
      `Ensure '${commandName}' is installed and available in PATH.`,
    )
  }

  /**
   * Factory method: Command exceeds maximum length.
   *
   * @param length - Actual command length
   * @param maxLength - Maximum allowed length
   * @returns ProcessError instance
   */
  public static commandTooLong(length: number, maxLength: number): ProcessError {
    return new ProcessError(
      `Command exceeds maximum length: ${length} > ${maxLength}`,
      ProcessErrorCode.COMMAND_TOO_LONG,
      {length, maxLength},
      `Reduce command length to ${maxLength} characters or less.`,
    )
  }

  /**
   * Factory method: Command execution failed.
   *
   * @param command - Command that failed
   * @param cause - Cause of failure
   * @returns ProcessError instance
   */
  public static executionFailed(command: string, cause: string): ProcessError {
    return new ProcessError(
      `Command execution failed: ${command}. Cause: ${cause}`,
      ProcessErrorCode.EXECUTION_FAILED,
      {cause, command},
      'Check command syntax and try again.',
    )
  }

  /**
   * Factory method: Invalid command validation.
   *
   * @param command - Command that failed validation
   * @param reason - Reason for validation failure
   * @returns ProcessError instance
   */
  public static invalidCommand(command: string, reason: string): ProcessError {
    return new ProcessError(
      `Invalid command: ${command}. Reason: ${reason}`,
      ProcessErrorCode.INVALID_COMMAND,
      {command, reason},
      'Ensure command is properly formatted and contains valid characters.',
    )
  }

  /**
   * Factory method: Invalid process configuration.
   *
   * @param reason - Reason why configuration is invalid
   * @returns ProcessError instance
   */
  public static invalidConfig(reason: string): ProcessError {
    return new ProcessError(
      `Invalid process configuration: ${reason}`,
      ProcessErrorCode.INVALID_CONFIG,
      {reason},
      'Review and correct ProcessConfig settings.',
    )
  }

  /**
   * Factory method: Invalid or unsafe working directory.
   *
   * @param path - Working directory path that failed validation
   * @param reason - Reason why path is invalid
   * @returns ProcessError instance
   */
  public static invalidWorkingDirectory(path: string, reason: string): ProcessError {
    return new ProcessError(
      `Invalid working directory: ${path}. Reason: ${reason}`,
      ProcessErrorCode.WORKING_DIRECTORY_INVALID,
      {path, reason},
      'Use a path within the configured base directory without ".." traversal.',
    )
  }

  /**
   * Factory method: Failed to terminate background process.
   *
   * @param processId - ID of process that failed to terminate
   * @param cause - Cause of failure
   * @returns ProcessError instance
   */
  public static killFailed(processId: string, cause: string): ProcessError {
    return new ProcessError(
      `Failed to kill process: ${processId}. Cause: ${cause}`,
      ProcessErrorCode.KILL_FAILED,
      {cause, processId},
      'Process may have already terminated or lacks permissions to kill.',
    )
  }

  /**
   * Factory method: ProcessService not initialized.
   *
   * @returns ProcessError instance
   */
  public static notInitialized(): ProcessError {
    return new ProcessError(
      'ProcessService not initialized',
      ProcessErrorCode.SERVICE_NOT_INITIALIZED,
      undefined,
      'Call initialize() before executing commands.',
    )
  }

  /**
   * Factory method: Output buffer exceeded size limit.
   *
   * @param processId - ID of process with full buffer
   * @param size - Current buffer size
   * @param maxSize - Maximum allowed size
   * @returns ProcessError instance
   */
  public static outputBufferFull(processId: string, size: number, maxSize: number): ProcessError {
    return new ProcessError(
      `Output buffer full for process ${processId}: ${size} >= ${maxSize} bytes`,
      ProcessErrorCode.OUTPUT_BUFFER_FULL,
      {maxSize, processId, size},
      'Increase maxOutputBuffer in ProcessConfig or read output more frequently.',
    )
  }

  /**
   * Factory method: Permission denied executing command.
   *
   * @param command - Command that was denied
   * @returns ProcessError instance
   */
  public static permissionDenied(command: string): ProcessError {
    const commandName = command.split(/\s+/)[0]
    return new ProcessError(
      `Permission denied: ${commandName}`,
      ProcessErrorCode.PERMISSION_DENIED,
      {command, commandName},
      `Ensure you have permission to execute '${commandName}' or run with appropriate privileges.`,
    )
  }

  /**
   * Factory method: Background process not found.
   *
   * @param processId - ID of process that was not found
   * @returns ProcessError instance
   */
  public static processNotFound(processId: string): ProcessError {
    return new ProcessError(
      `Process not found: ${processId}`,
      ProcessErrorCode.PROCESS_NOT_FOUND,
      {processId},
      'Process may have completed and been cleaned up, or the ID is invalid.',
    )
  }

  /**
   * Factory method: Command execution timed out.
   *
   * @param command - Command that timed out
   * @param timeout - Timeout value in milliseconds
   * @returns ProcessError instance
   */
  public static timeout(command: string, timeout: number): ProcessError {
    return new ProcessError(
      `Command timed out after ${timeout}ms: ${command}`,
      ProcessErrorCode.TIMEOUT,
      {command, timeout},
      'Increase timeout value or optimize the command to run faster.',
    )
  }

  /**
   * Factory method: Too many concurrent background processes.
   *
   * @param current - Current number of running processes
   * @param max - Maximum allowed concurrent processes
   * @returns ProcessError instance
   */
  public static tooManyProcesses(current: number, max: number): ProcessError {
    return new ProcessError(
      `Too many concurrent processes: ${current} >= ${max}`,
      ProcessErrorCode.TOO_MANY_PROCESSES,
      {current, max},
      'Wait for existing processes to complete or increase maxConcurrentProcesses.',
    )
  }
}
