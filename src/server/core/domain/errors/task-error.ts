/**
 * Task Error Codes
 * Used for structured error handling in task execution.
 */
export const TaskErrorCode = {
  // Agent errors
  AGENT_DISCONNECTED: 'ERR_AGENT_DISCONNECTED',
  AGENT_NOT_AVAILABLE: 'ERR_AGENT_NOT_AVAILABLE',
  AGENT_NOT_INITIALIZED: 'ERR_AGENT_NOT_INITIALIZED',

  // Context tree errors
  CONTEXT_TREE_NOT_INITIALIZED: 'ERR_CONTEXT_TREE_NOT_INIT',

  // LLM errors
  LLM_ERROR: 'ERR_LLM_ERROR',
  LLM_RATE_LIMIT: 'ERR_LLM_RATE_LIMIT',
  LOCAL_CHANGES_EXIST: 'ERR_LOCAL_CHANGES_EXIST',

  // Auth/Init errors
  NOT_AUTHENTICATED: 'ERR_NOT_AUTHENTICATED',
  // OAuth errors
  OAUTH_REFRESH_FAILED: 'ERR_OAUTH_REFRESH_FAILED',
  OAUTH_TOKEN_EXPIRED: 'ERR_OAUTH_TOKEN_EXPIRED',
  // Execution errors
  PROJECT_NOT_INIT: 'ERR_PROJECT_NOT_INIT',
  PROVIDER_NOT_CONFIGURED: 'ERR_PROVIDER_NOT_CONFIGURED',
  SPACE_NOT_CONFIGURED: 'ERR_SPACE_NOT_CONFIGURED',
  SPACE_NOT_FOUND: 'ERR_SPACE_NOT_FOUND',
  TASK_CANCELLED: 'ERR_TASK_CANCELLED',

  TASK_EXECUTION: 'ERR_TASK_EXECUTION',
  TASK_TIMEOUT: 'ERR_TASK_TIMEOUT',

  // Unknown
  UNKNOWN: 'ERR_UNKNOWN',

  // Version control
  VC_GIT_INITIALIZED: 'ERR_VC_GIT_INITIALIZED',
} as const

export type TaskErrorCodeType = (typeof TaskErrorCode)[keyof typeof TaskErrorCode]

/**
 * Structured error object for transport.
 * All task errors should conform to this shape.
 */
export interface TaskErrorData {
  code?: TaskErrorCodeType
  details?: Record<string, unknown>
  message: string
  name: string
}

/**
 * Base error class for task-related errors.
 */
export class TaskError extends Error {
  public readonly code: TaskErrorCodeType
  public readonly details?: Record<string, unknown>

  public constructor(
    message: string,
    code: TaskErrorCodeType = TaskErrorCode.UNKNOWN,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'TaskError'
    this.code = code
    this.details = details
  }

  /**
   * Serialize error for transport.
   */
  public toJSON(): TaskErrorData {
    return {
      code: this.code,
      ...(this.details ? {details: this.details} : {}),
      message: this.message,
      name: this.name,
    }
  }
}

/**
 * Serialize any error to TaskErrorData.
 * Use this when catching errors to send via transport.
 * Preserves original error properties - only adds code if error already has one or has known mapping.
 */
export function serializeTaskError(error: unknown): TaskErrorData {
  // Already a TaskError - has code
  if (error instanceof TaskError) {
    return error.toJSON()
  }

  // Standard Error with name
  if (error instanceof Error) {
    // Check for known error names and map to codes
    const codeMap: Record<string, TaskErrorCodeType> = {
      AuthError: TaskErrorCode.NOT_AUTHENTICATED,
      LlmGenerationError: TaskErrorCode.LLM_ERROR,
      LlmRateLimitError: TaskErrorCode.LLM_RATE_LIMIT,
      RateLimitError: TaskErrorCode.LLM_RATE_LIMIT,
      TaskCancelledError: TaskErrorCode.TASK_CANCELLED,
      TimeoutError: TaskErrorCode.TASK_TIMEOUT,
      WorkspaceNotInitializedError: TaskErrorCode.PROJECT_NOT_INIT,
    }

    const code = codeMap[error.name]

    return {
      ...(code ? {code} : {}),
      message: error.message,
      name: error.name,
    }
  }

  // Unknown error type — extract message if possible, JSON.stringify to avoid "[object Object]"
  if (error && typeof error === 'object') {
    if ('message' in error) {
      const msg = (error as Record<string, unknown>).message
      if (typeof msg === 'string') {
        return {
          message: msg,
          name: 'Error',
        }
      }
    }

    try {
      return {
        message: JSON.stringify(error),
        name: 'Error',
      }
    } catch {
      // circular reference — fall through
    }
  }

  return {
    message: String(error),
    name: 'Error',
  }
}

// Specific error classes for common cases

export class AgentNotAvailableError extends TaskError {
  public constructor() {
    super('Agent not available. Please wait for Agent to connect.', TaskErrorCode.AGENT_NOT_AVAILABLE)
    this.name = 'AgentNotAvailableError'
  }
}

export class AgentDisconnectedError extends TaskError {
  public constructor() {
    super('Agent disconnected', TaskErrorCode.AGENT_DISCONNECTED)
    this.name = 'AgentDisconnectedError'
  }
}

export class AgentNotInitializedError extends TaskError {
  public constructor(reason?: string) {
    super(
      reason
        ? `Agent failed to initialize: ${reason}`
        : "Agent failed to initialize. Run 'brv restart' to force a clean restart.",
      TaskErrorCode.AGENT_NOT_INITIALIZED,
    )
    this.name = 'AgentNotInitializedError'
  }
}

export class NotAuthenticatedError extends TaskError {
  public constructor() {
    super(
      'Not authenticated. Cloud sync features (push/pull/space) require login — local query and curate work without authentication.',
      TaskErrorCode.NOT_AUTHENTICATED,
    )
    this.name = 'NotAuthenticatedError'
  }
}

export class ProjectNotInitError extends TaskError {
  public constructor() {
    super('Project not initialized. Run "brv restart" to reinitialize.', TaskErrorCode.PROJECT_NOT_INIT)
    this.name = 'ProjectNotInitError'
  }
}

export class ContextTreeNotInitializedError extends TaskError {
  public constructor() {
    super('Context tree not initialized', TaskErrorCode.CONTEXT_TREE_NOT_INITIALIZED)
    this.name = 'ContextTreeNotInitializedError'
  }
}

export class FileValidationError extends Error {
  public constructor(message = 'File validation failed. Please check file paths.') {
    super(message)
    this.name = 'FileValidationError'
  }
}

export class LocalChangesExistError extends TaskError {
  public constructor(message = 'Local changes exist. Run "brv push" to save your changes before pulling.') {
    super(message, TaskErrorCode.LOCAL_CHANGES_EXIST)
    this.name = 'LocalChangesExistError'
  }
}

export class SpaceNotConfiguredError extends TaskError {
  public constructor() {
    super(
      'No space configured. Run "brv space list" to see available spaces, then "brv space switch --team <team> --name <space>" to select one.',
      TaskErrorCode.SPACE_NOT_CONFIGURED,
    )
    this.name = 'SpaceNotConfiguredError'
  }
}

export class GitVcInitializedError extends TaskError {
  public constructor(message: string) {
    super(message, TaskErrorCode.VC_GIT_INITIALIZED)
    this.name = 'GitVcInitializedError'
  }
}

export class SpaceNotFoundError extends TaskError {
  public constructor() {
    super('Space not found', TaskErrorCode.SPACE_NOT_FOUND)
    this.name = 'SpaceNotFoundError'
  }
}
