import {ExitCode, ExitError} from '../exit-codes.js'
import {AgentErrorCode} from './agent-error-codes.js'

/**
 * Agent-specific error with typed error codes.
 * Extends ExitError for oclif CLI integration.
 *
 * Follows DextoAgent pattern with static factory methods
 * for creating well-typed errors.
 */
export class AgentError extends ExitError {
  public readonly agentErrorCode: AgentErrorCode
  public readonly details?: unknown

  constructor(agentErrorCode: AgentErrorCode, exitCode: ExitCode, message: string, details?: unknown) {
    super(exitCode, message)
    this.name = 'AgentError'
    this.agentErrorCode = agentErrorCode
    this.details = details
  }

  /**
   * Agent is already started and cannot be started again.
   */
  static alreadyStarted(): AgentError {
    return new AgentError(
      AgentErrorCode.ALREADY_STARTED,
      ExitCode.RUNTIME_ERROR,
      'Agent is already started. Call stop() before restarting.',
    )
  }

  /**
   * Agent execution failed.
   */
  static executionFailed(reason: string, details?: unknown): AgentError {
    return new AgentError(
      AgentErrorCode.EXECUTION_FAILED,
      ExitCode.RUNTIME_ERROR,
      `Agent execution failed: ${reason}`,
      details,
    )
  }

  /**
   * Agent initialization failed.
   */
  static initializationFailed(reason: string, details?: unknown): AgentError {
    return new AgentError(
      AgentErrorCode.INITIALIZATION_FAILED,
      ExitCode.RUNTIME_ERROR,
      `Agent initialization failed: ${reason}`,
      details,
    )
  }

  /**
   * Invalid agent configuration.
   */
  static invalidConfig(reason: string, details?: unknown): AgentError {
    return new AgentError(
      AgentErrorCode.INVALID_CONFIG,
      ExitCode.CONFIG_ERROR,
      `Invalid agent configuration: ${reason}`,
      details,
    )
  }

  /**
   * Required service is missing during agent start.
   */
  static missingRequiredService(serviceName: string): AgentError {
    return new AgentError(
      AgentErrorCode.MISSING_REQUIRED_SERVICE,
      ExitCode.RUNTIME_ERROR,
      `Required service '${serviceName}' is missing during agent start.`,
    )
  }

  /**
   * Agent must be started before performing operations.
   */
  static notStarted(): AgentError {
    return new AgentError(
      AgentErrorCode.NOT_STARTED,
      ExitCode.RUNTIME_ERROR,
      'Agent must be started before use. Call start() first.',
    )
  }

  /**
   * Service not initialized (internal bug).
   */
  static serviceNotInitialized(serviceName: string): AgentError {
    return new AgentError(
      AgentErrorCode.SERVICE_NOT_INITIALIZED,
      ExitCode.RUNTIME_ERROR,
      `Service '${serviceName}' not initialized. This is a bug.`,
    )
  }

  /**
   * Maximum session limit exceeded.
   */
  static sessionLimitExceeded(limit: number): AgentError {
    return new AgentError(
      AgentErrorCode.SESSION_LIMIT_EXCEEDED,
      ExitCode.RUNTIME_ERROR,
      `Maximum sessions (${limit}) reached. Delete unused sessions or increase limit.`,
    )
  }

  /**
   * Session not found.
   */
  static sessionNotFound(sessionId: string): AgentError {
    return new AgentError(AgentErrorCode.SESSION_NOT_FOUND, ExitCode.VALIDATION_ERROR, `Session '${sessionId}' not found.`)
  }

  /**
   * Agent has been stopped and cannot be used.
   */
  static stopped(): AgentError {
    return new AgentError(
      AgentErrorCode.STOPPED,
      ExitCode.RUNTIME_ERROR,
      'Agent has been stopped and cannot be used. Create a new instance or call start() again.',
    )
  }
}
