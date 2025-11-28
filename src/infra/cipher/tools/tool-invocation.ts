/**
 * Tool Invocation Builder Pattern
 *
 * Implements a two-phase tool execution architecture:
 * 1. Builder Phase: Validate tool call and build invocation
 * 2. Invocation Phase: Execute the validated invocation
 *
 * This separation enables:
 * - Early validation before execution
 * - Queuing of validated invocations
 * - Retry logic without re-validation
 * - Better error handling and debugging
 */

import type {Tool, ToolExecutionContext} from '../../../core/domain/cipher/tools/types.js'

import {ToolError, ToolErrorType} from '../../../core/domain/cipher/tools/tool-error.js'

/**
 * Status of a tool invocation.
 *
 * Simplified for autonomous execution - no AWAITING_APPROVAL or CANCELLED states.
 * Added DENIED for policy rejections.
 */
export enum ToolInvocationStatus {
  /**
   * Invocation completed successfully
   */
  COMPLETED = 'COMPLETED',

  /**
   * Invocation was denied by policy
   */
  DENIED = 'DENIED',

  /**
   * Invocation failed with error
   */
  ERROR = 'ERROR',

  /**
   * Invocation is currently executing
   */
  EXECUTING = 'EXECUTING',

  /**
   * Invocation is scheduled for execution
   */
  SCHEDULED = 'SCHEDULED',

  /**
   * Invocation is validating (builder phase)
   */
  VALIDATING = 'VALIDATING',
}

/**
 * Result from tool invocation execution
 */
export interface ToolInvocationResult {
  /**
   * Duration of execution in milliseconds
   */
  durationMs: number

  /**
   * Error if execution failed
   */
  error?: ToolError

  /**
   * Execution result (if successful)
   */
  result?: unknown

  /**
   * Final status after execution
   */
  status: ToolInvocationStatus

  /**
   * Timestamp when execution completed
   */
  timestamp: number
}

/**
 * Options for creating a tool invocation
 */
export interface ToolInvocationOptions {
  /**
   * Validated tool arguments
   */
  args: Record<string, unknown>
  /**
   * Execution context (sessionId, etc.)
   */
  context: ToolExecutionContext
  /**
   * Unique identifier for this invocation
   */
  id: string
  /**
   * Tool instance
   */
  tool: Tool
  /**
   * Tool name
   */
  toolName: string
}

/**
 * Validated tool invocation ready for execution
 *
 * Contains all information needed to execute a tool call:
 * - Tool reference and metadata
 * - Validated arguments
 * - Execution context
 * - Status tracking
 */
export class ToolInvocation {
  /**
   * Validated tool arguments
   */
  public readonly args: Record<string, unknown>
  /**
   * Execution context (sessionId, etc.)
   */
  public readonly context: ToolExecutionContext
  /**
   * Unique identifier for this invocation
   */
  public readonly id: string
  /**
   * Tool instance
   */
  public readonly tool: Tool
  /**
   * Tool name
   */
  public readonly toolName: string
  /**
   * Current status
   */
  private _status: ToolInvocationStatus = ToolInvocationStatus.SCHEDULED
  /**
   * Timestamp when invocation was created
   */
  private readonly createdAt: number = Date.now()

  /**
   * Create a new tool invocation
   *
   * @param options - Tool invocation options
   */
  constructor(options: ToolInvocationOptions) {
    this.id = options.id
    this.toolName = options.toolName
    this.tool = options.tool
    this.args = options.args
    this.context = options.context
  }

  /**
   * Get current status
   */
  get status(): ToolInvocationStatus {
    return this._status
  }

  /**
   * Mark this invocation as denied by policy.
   *
   * Can only deny if not yet executing or completed.
   *
   * @returns True if denied, false if already executing/completed
   */
  deny(): boolean {
    if (
      this._status === ToolInvocationStatus.EXECUTING ||
      this._status === ToolInvocationStatus.COMPLETED ||
      this._status === ToolInvocationStatus.ERROR ||
      this._status === ToolInvocationStatus.DENIED
    ) {
      return false
    }

    this._status = ToolInvocationStatus.DENIED
    return true
  }

  /**
   * Execute this invocation
   *
   * Transitions through states:
   * SCHEDULED -> EXECUTING -> COMPLETED/ERROR
   *
   * @returns Execution result
   */
  async execute(): Promise<ToolInvocationResult> {
    // Check if invocation was denied by policy
    if (this._status === ToolInvocationStatus.DENIED) {
      return {
        durationMs: 0,
        error: new ToolError('Tool invocation was denied by policy', ToolErrorType.PERMISSION_DENIED, this.toolName),
        status: ToolInvocationStatus.DENIED,
        timestamp: Date.now(),
      }
    }

    // Check if invocation is in executable state
    if (this._status !== ToolInvocationStatus.SCHEDULED) {
      return {
        durationMs: 0,
        error: new ToolError(
          `Cannot execute invocation in status: ${this._status}`,
          ToolErrorType.EXECUTION_FAILED,
          this.toolName
        ),
        status: this._status,
        timestamp: Date.now(),
      }
    }

    // Start execution
    this._status = ToolInvocationStatus.EXECUTING
    const startTime = Date.now()

    try {
      // Execute tool with validated arguments
      const result = await this.tool.execute(this.args, this.context)

      // Mark as completed
      this._status = ToolInvocationStatus.COMPLETED
      const durationMs = Date.now() - startTime

      return {
        durationMs,
        result,
        status: ToolInvocationStatus.COMPLETED,
        timestamp: Date.now(),
      }
    } catch (error) {
      // Mark as error
      this._status = ToolInvocationStatus.ERROR
      const durationMs = Date.now() - startTime

      // Convert to ToolError
      const toolError =
        error instanceof ToolError
          ? error
          : new ToolError(
              error instanceof Error ? error.message : String(error),
              ToolErrorType.EXECUTION_FAILED,
              this.toolName,
              {originalError: error instanceof Error ? error : undefined}
            )

      return {
        durationMs,
        error: toolError,
        status: ToolInvocationStatus.ERROR,
        timestamp: Date.now(),
      }
    }
  }

  /**
   * Get age of this invocation in milliseconds
   */
  getAge(): number {
    return Date.now() - this.createdAt
  }

  /**
   * Check if invocation can be executed
   */
  isExecutable(): boolean {
    return this._status === ToolInvocationStatus.SCHEDULED
  }
}

/**
 * Builder for creating validated tool invocations
 *
 * Validates tool existence, arguments, and builds executable invocations.
 * Separates validation concerns from execution.
 */
export class ToolInvocationBuilder {
  /**
   * Map of tool name to tool instance
   */
  private readonly tools: Map<string, Tool>

  /**
   * Create a new tool invocation builder
   *
   * @param tools - Map of available tools
   */
  constructor(tools: Map<string, Tool>) {
    this.tools = tools
  }

  /**
   * Build and validate a tool invocation
   *
   * Performs validation:
   * 1. Tool exists
   * 2. Arguments match schema
   * 3. Required parameters present
   *
   * @param id - Unique invocation ID (e.g., from LLM tool call)
   * @param toolName - Name of tool to invoke
   * @param args - Tool arguments
   * @param context - Execution context
   * @returns Validated tool invocation ready for execution
   * @throws ToolError if validation fails
   */
  build(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext = {}
  ): ToolInvocation {
    // Check tool exists
    const tool = this.tools.get(toolName)
    if (!tool) {
      throw new ToolError(
        `Tool '${toolName}' not found`,
        ToolErrorType.TOOL_NOT_FOUND,
        toolName,
        {
          context: {
            availableTools: [...this.tools.keys()],
          },
        }
      )
    }

    // Validate arguments against schema
    try {
      const validatedArgs = tool.inputSchema.parse(args)

      // Create invocation with validated arguments
      return new ToolInvocation({
        args: validatedArgs as Record<string, unknown>,
        context,
        id,
        tool,
        toolName,
      })
    } catch (error) {
      // Handle Zod validation errors
      if (error && typeof error === 'object' && 'errors' in error) {
        const zodError = error as {errors: Array<{message: string; path: Array<number | string>}>}
        const errorMessages = zodError.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join('; ')

        throw new ToolError(
          `Invalid arguments: ${errorMessages}`,
          ToolErrorType.INVALID_PARAMS,
          toolName,
          {originalError: error instanceof Error ? error : undefined}
        )
      }

      // Handle other validation errors
      throw new ToolError(
        error instanceof Error ? error.message : String(error),
        ToolErrorType.PARAM_VALIDATION_FAILED,
        toolName,
        {originalError: error instanceof Error ? error : undefined}
      )
    }
  }

  /**
   * Validate tool arguments without building invocation
   *
   * Useful for pre-validation or dry-run checks.
   *
   * @param toolName - Name of tool
   * @param args - Arguments to validate
   * @returns True if valid
   * @throws ToolError if validation fails
   */
  validate(toolName: string, args: Record<string, unknown>): boolean {
    // Check tool exists
    const tool = this.tools.get(toolName)
    if (!tool) {
      throw new ToolError(`Tool '${toolName}' not found`, ToolErrorType.TOOL_NOT_FOUND, toolName)
    }

    // Validate against schema
    try {
      tool.inputSchema.parse(args)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && 'errors' in error) {
        const zodError = error as {errors: Array<{message: string; path: Array<number | string>}>}
        const errorMessages = zodError.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join('; ')

        throw new ToolError(
          `Invalid arguments: ${errorMessages}`,
          ToolErrorType.INVALID_PARAMS,
          toolName,
          {originalError: error instanceof Error ? error : undefined}
        )
      }

      throw new ToolError(
        error instanceof Error ? error.message : String(error),
        ToolErrorType.PARAM_VALIDATION_FAILED,
        toolName,
        {originalError: error instanceof Error ? error : undefined}
      )
    }
  }
}
