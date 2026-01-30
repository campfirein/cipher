/**
 * Tool Scheduler Interface.
 *
 * Orchestrates tool execution with:
 * 1. Policy checking (ALLOW/DENY)
 * 2. State tracking (pending → executing → completed/failed/denied)
 * 3. Execution history for debugging/auditing
 *
 * Based on gemini-cli's CoreToolScheduler pattern, simplified for autonomous mode.
 */

import type {PolicyEvaluationResult} from './i-policy-engine.js'

/**
 * Status of a scheduled tool execution.
 */
export type ScheduledToolStatus = 'completed' | 'denied' | 'executing' | 'failed' | 'pending'

/**
 * Represents a scheduled tool execution with tracking information.
 */
export interface ScheduledToolExecution {
  /**
   * Arguments passed to the tool.
   */
  args: Record<string, unknown>

  /**
   * When execution completed (success, failure, or denial).
   */
  completedAt?: Date

  /**
   * Error that occurred (if failed or denied).
   */
  error?: Error

  /**
   * Unique identifier for this execution.
   */
  id: string

  /**
   * Result of policy evaluation (if performed).
   */
  policyResult?: PolicyEvaluationResult

  /**
   * Tool execution result (if completed successfully).
   */
  result?: unknown

  /**
   * When execution started.
   */
  startedAt?: Date

  /**
   * Current status of the execution.
   */
  status: ScheduledToolStatus

  /**
   * Name of the tool being executed.
   */
  toolName: string
}

/**
 * Context for tool execution.
 */
export interface ToolSchedulerContext {
  /**
   * Session ID for the current session.
   */
  sessionId: string
  /**
   * Task ID for billing tracking (passed from usecase to subagents).
   */
  taskId?: string
}

/**
 * Interface for the tool scheduler.
 *
 * The scheduler coordinates tool execution by:
 * 1. Checking policy rules before execution
 * 2. Tracking execution state transitions
 * 3. Maintaining execution history for debugging
 */
export interface IToolScheduler {
  /**
   * Clear execution history.
   * Useful for testing or memory management.
   */
  clearHistory(): void

  /**
   * Schedule and execute a tool call.
   *
   * Flow:
   * 1. Create execution record (pending)
   * 2. Evaluate policy (ALLOW/DENY)
   * 3. If ALLOW: execute tool (executing → completed/failed)
   * 4. If DENY: throw error (denied)
   *
   * @param toolName - Name of the tool to execute
   * @param args - Arguments for the tool
   * @param context - Execution context with session info
   * @returns Tool execution result
   * @throws Error if tool is denied by policy or execution fails
   */
  execute(toolName: string, args: Record<string, unknown>, context: ToolSchedulerContext): Promise<unknown>

  /**
   * Get execution history for debugging/auditing.
   * Returns most recent executions (implementation may limit size).
   *
   * @returns Read-only array of scheduled executions
   */
  getHistory(): readonly ScheduledToolExecution[]
}
