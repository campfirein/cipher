/**
 * Core Tool Scheduler Implementation.
 *
 * Orchestrates tool execution with:
 * 1. Policy checking (ALLOW/DENY)
 * 2. State tracking (pending → executing → completed/failed/denied)
 * 3. Execution history for debugging/auditing
 *
 * Based on gemini-cli's CoreToolScheduler pattern, simplified for autonomous mode.
 */

import {randomUUID} from 'node:crypto'

import type {IPolicyEngine, PolicyEvaluationResult} from '../../core/interfaces/i-policy-engine.js'
import type {IToolProvider} from '../../core/interfaces/i-tool-provider.js'
import type {
  IToolScheduler,
  ScheduledToolExecution,
  ScheduledToolStatus,
  ToolSchedulerContext,
} from '../../core/interfaces/i-tool-scheduler.js'
import type {SessionEventBus} from '../events/event-emitter.js'

/**
 * Configuration options for CoreToolScheduler.
 */
export interface CoreToolSchedulerConfig {
  /**
   * Maximum number of executions to keep in history.
   * Older executions are removed when this limit is exceeded.
   * @default 100
   */
  maxHistorySize?: number

  /**
   * Whether to log state changes to console.
   * @default false
   */
  verbose?: boolean
}

/**
 * Error thrown when a tool is denied by policy.
 */
export class ToolDeniedError extends Error {
  public readonly policyResult: PolicyEvaluationResult
  public readonly toolName: string

  constructor(toolName: string, policyResult: PolicyEvaluationResult) {
    super(`Tool '${toolName}' denied by policy: ${policyResult.reason ?? 'No reason provided'}`)
    this.name = 'ToolDeniedError'
    this.toolName = toolName
    this.policyResult = policyResult

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ToolDeniedError)
    }
  }
}

/**
 * Core Tool Scheduler implementation.
 *
 * Coordinates tool execution by:
 * 1. Checking policy rules before execution
 * 2. Tracking execution state transitions
 * 3. Maintaining execution history for debugging
 */
export class CoreToolScheduler implements IToolScheduler {
  private readonly config: Required<CoreToolSchedulerConfig>
  private readonly eventBus?: SessionEventBus
  private history: ScheduledToolExecution[] = []
  private readonly policyEngine: IPolicyEngine
  private readonly toolProvider: IToolProvider

  /**
   * Create a new CoreToolScheduler.
   *
   * @param toolProvider - Provider for tool execution
   * @param policyEngine - Engine for policy decisions
   * @param eventBus - Optional event bus for emitting events
   * @param config - Configuration options
   */
  constructor(
    toolProvider: IToolProvider,
    policyEngine: IPolicyEngine,
    eventBus?: SessionEventBus,
    config: CoreToolSchedulerConfig = {},
  ) {
    this.toolProvider = toolProvider
    this.policyEngine = policyEngine
    this.eventBus = eventBus
    this.config = {
      maxHistorySize: config.maxHistorySize ?? 100,
      verbose: config.verbose ?? false,
    }
  }

  /**
   * Clear execution history.
   */
  clearHistory(): void {
    this.history = []
  }

  /**
   * Schedule and execute a tool call.
   *
   * @param toolName - Name of the tool to execute
   * @param args - Arguments for the tool
   * @param context - Execution context with session info
   * @returns Tool execution result
   * @throws ToolDeniedError if tool is denied by policy
   * @throws Error if execution fails
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolSchedulerContext,
  ): Promise<unknown> {
    // Create execution record
    const execution = this.createExecution(toolName, args)

    // Step 1: Policy check
    const policyResult = this.policyEngine.evaluate(toolName, args)
    execution.policyResult = policyResult

    this.emitPolicyChecked(execution, policyResult)

    if (policyResult.decision === 'DENY') {
      this.updateStatus(execution, 'denied')
      execution.completedAt = new Date()
      const error = new ToolDeniedError(toolName, policyResult)
      execution.error = error
      throw error
    }

    // Step 2: Execute
    this.updateStatus(execution, 'executing')
    execution.startedAt = new Date()

    try {
      // Pass full context (including taskId, commandType, metadata) to toolProvider
      const result = await this.toolProvider.executeTool(toolName, args, context.sessionId, {
        commandType: context.commandType,
        metadata: context.metadata,
        sessionId: context.sessionId,
        taskId: context.taskId,
      })

      this.updateStatus(execution, 'completed')
      execution.result = result
      execution.completedAt = new Date()

      return result
    } catch (error) {
      this.updateStatus(execution, 'failed')
      execution.error = error instanceof Error ? error : new Error(String(error))
      execution.completedAt = new Date()
      throw error
    }
  }

  /**
   * Get execution history.
   *
   * @returns Read-only array of scheduled executions
   */
  getHistory(): readonly ScheduledToolExecution[] {
    return this.history
  }

  /**
   * Add an execution to history, maintaining max size.
   */
  private addToHistory(execution: ScheduledToolExecution): void {
    this.history.push(execution)
    if (this.history.length > this.config.maxHistorySize) {
      this.history.shift()
    }
  }

  /**
   * Create a new execution record.
   */
  private createExecution(toolName: string, args: Record<string, unknown>): ScheduledToolExecution {
    const execution: ScheduledToolExecution = {
      args,
      id: randomUUID(),
      status: 'pending',
      toolName,
    }
    this.addToHistory(execution)
    return execution
  }

  /**
   * Emit policy check event.
   */
  private emitPolicyChecked(execution: ScheduledToolExecution, result: PolicyEvaluationResult): void {
    // Emit warning for denied tools
    if (this.eventBus && result.decision === 'DENY') {
      this.eventBus.emit('llmservice:warning', {
        message: `Tool '${execution.toolName}' denied by policy: ${result.reason ?? 'No reason provided'}`,
      })
    }
  }

  /**
   * Update execution status and emit event.
   */
  private updateStatus(execution: ScheduledToolExecution, status: ScheduledToolStatus): void {
    execution.status = status
  }
}
