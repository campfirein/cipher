/**
 * Shared utility for handling connection errors in CLI commands.
 * Extracted from query.ts and curate.ts to avoid code duplication.
 */
import {
  ConnectionError,
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../core/domain/errors/connection-error.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from './sandbox-detector.js'

/**
 * Error handler callback type for oclif commands.
 * @param message - Error message to display
 * @param options - Options for the error (exit code, etc.)
 */
type ErrorCallback = (message: string, options: {exit: number}) => never

/**
 * Format and handle connection-related errors with user-friendly messages.
 *
 * @param error - The error to handle
 * @param errorCallback - The oclif command's error() method
 */
export function handleConnectionError(error: unknown, errorCallback: ErrorCallback): never {
  if (error instanceof NoInstanceRunningError) {
    if (isSandboxEnvironment()) {
      const sandboxName = getSandboxEnvironmentName()
      errorCallback(
        `Error: No ByteRover instance is running.\n` +
          `⚠️  Sandbox environment detected (${sandboxName}).\n\n` +
          `Please run 'brv' command in a separate terminal window/tab outside the sandbox first.`,
        {exit: 1},
      )
    } else {
      errorCallback(
        'No ByteRover instance is running.\n\n' +
          'Start a ByteRover instance by running "brv" in a separate terminal window/tab.\n' +
          'The instance will keep running and handle your commands.',
        {exit: 1},
      )
    }
  }

  if (error instanceof InstanceCrashedError) {
    errorCallback('ByteRover instance has crashed.\n\nPlease restart with: brv', {exit: 1})
  }

  if (error instanceof ConnectionFailedError) {
    const isSandboxError = isSandboxNetworkError(error.originalError ?? error)

    if (isSandboxError) {
      const sandboxName = getSandboxEnvironmentName()
      errorCallback(
        `Error: Failed to connect to ByteRover instance.\n` +
          `Port: ${error.port ?? 'unknown'}\n` +
          `⚠️  Sandbox network restriction detected (${sandboxName}).\n\n` +
          `Please allow network access in the sandbox and retry the command.`,
        {exit: 1},
      )
    } else {
      errorCallback(`Failed to connect to ByteRover instance: ${error.message}`, {exit: 1})
    }
  }

  if (error instanceof ConnectionError) {
    errorCallback(`Connection error: ${error.message}`, {exit: 1})
  }

  // Unknown error
  const message = error instanceof Error ? error.message : String(error)
  errorCallback(`Unexpected error: ${message}`, {exit: 1})
}
