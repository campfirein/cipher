/**
 * Error codes for process execution failures.
 *
 * Used by ProcessError factory to create structured error objects.
 */
export enum ProcessErrorCode {
  /**
   * Command matches a blocked pattern.
   *
   * Command is explicitly forbidden by security policy.
   */
  COMMAND_BLOCKED = 'COMMAND_BLOCKED',

  /**
   * Command not found in PATH.
   *
   * System returned ENOENT error.
   */
  COMMAND_NOT_FOUND = 'COMMAND_NOT_FOUND',

  /**
   * Command exceeds maximum length.
   *
   * Commands longer than 10,000 characters are rejected.
   */
  COMMAND_TOO_LONG = 'COMMAND_TOO_LONG',

  /**
   * Command execution failed.
   *
   * Generic execution error (non-zero exit code, spawn failure, etc.).
   */
  EXECUTION_FAILED = 'EXECUTION_FAILED',

  /**
   * Command injection detected.
   *
   * Command contains unsafe patterns like command chaining or substitution.
   */
  INJECTION_DETECTED = 'INJECTION_DETECTED',

  /**
   * Command validation failed.
   *
   * Command is malformed or violates security policy.
   */
  INVALID_COMMAND = 'INVALID_COMMAND',

  /**
   * Process configuration is invalid.
   *
   * Invalid ProcessConfig provided to constructor.
   */
  INVALID_CONFIG = 'INVALID_CONFIG',

  /**
   * Failed to terminate background process.
   *
   * Process.kill() threw an error or process didn't stop.
   */
  KILL_FAILED = 'KILL_FAILED',

  /**
   * Output buffer exceeded size limit.
   *
   * Background process output exceeded maxOutputBuffer bytes.
   */
  OUTPUT_BUFFER_FULL = 'OUTPUT_BUFFER_FULL',

  /**
   * Permission denied executing command.
   *
   * System returned EACCES error.
   */
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  /**
   * Background process not found.
   *
   * Invalid or expired processId.
   */
  PROCESS_NOT_FOUND = 'PROCESS_NOT_FOUND',

  /**
   * ProcessService not initialized.
   *
   * Must call initialize() before executing commands.
   */
  SERVICE_NOT_INITIALIZED = 'SERVICE_NOT_INITIALIZED',

  /**
   * Command execution timed out.
   *
   * Process exceeded timeout limit and was killed.
   */
  TIMEOUT = 'TIMEOUT',

  /**
   * Too many concurrent background processes.
   *
   * Exceeded maxConcurrentProcesses limit.
   */
  TOO_MANY_PROCESSES = 'TOO_MANY_PROCESSES',

  /**
   * Working directory is invalid or unsafe.
   *
   * Directory doesn't exist, is outside base directory, or contains path traversal.
   */
  WORKING_DIRECTORY_INVALID = 'WORKING_DIRECTORY_INVALID',
}
