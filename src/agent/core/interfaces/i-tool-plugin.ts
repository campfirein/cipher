import type { ToolExecutionResult } from '../domain/tools/tool-error.js'

/**
 * Context provided to plugin hooks during tool execution.
 * Contains metadata about the current tool invocation.
 */
export interface ToolHookContext {
  /** Unique identifier for this tool call */
  callId: string

  /** Session ID where the tool is being executed */
  sessionId: string

  /** Name of the tool being executed */
  toolName: string
}

/**
 * Result from a before-execute hook.
 * Determines whether tool execution should proceed and allows argument modification.
 */
export interface BeforeHookResult {
  /**
   * Modified arguments to use for execution.
   * If provided, these replace the original arguments.
   */
  args?: Record<string, unknown>

  /**
   * Whether to proceed with tool execution.
   * If false, execution is blocked and reason should explain why.
   */
  proceed: boolean

  /**
   * Reason for blocking execution (when proceed is false).
   * Used to generate an error message for the LLM.
   */
  reason?: string
}

/**
 * Plugin interface for extending tool execution behavior.
 *
 * Plugins can intercept tool execution at two points:
 * 1. beforeExecute: Called before the tool runs. Can modify args or block execution.
 * 2. afterExecute: Called after the tool completes. Can log, audit, or react to results.
 *
 * @example
 * ```typescript
 * const loggingPlugin: IToolPlugin = {
 *   name: 'logging',
 *   priority: 1,
 *   beforeExecute(ctx, args) {
 *     console.log(`[${ctx.toolName}] Starting with args:`, args)
 *     return { proceed: true }
 *   },
 *   afterExecute(ctx, args, result) {
 *     console.log(`[${ctx.toolName}] Completed:`, result.success ? 'success' : 'error')
 *   }
 * }
 * ```
 */
export interface IToolPlugin {
  /**
   * Called after a tool has completed execution.
   * Receives the original arguments and the execution result.
   *
   * Use for logging, auditing, analytics, or triggering side effects.
   * Errors in afterExecute are caught and logged but don't affect the result.
   *
   * @param ctx - Hook context with tool metadata
   * @param args - Arguments that were passed to the tool
   * @param result - Result from tool execution
   */
  afterExecute?(
    ctx: ToolHookContext,
    args: Record<string, unknown>,
    result: ToolExecutionResult
  ): Promise<void> | void

  /**
   * Called before a tool is executed.
   * Can inspect/modify arguments or block execution entirely.
   *
   * @param ctx - Hook context with tool metadata
   * @param args - Arguments to be passed to the tool
   * @returns Result indicating whether to proceed and optionally modified args
   */
  beforeExecute?(
    ctx: ToolHookContext,
    args: Record<string, unknown>
  ): BeforeHookResult | Promise<BeforeHookResult>

  /**
   * Unique name for this plugin.
   * Used for logging and to allow unregistering by name.
   */
  name: string

  /**
   * Execution priority (lower = earlier).
   * Plugins with lower priority numbers execute first.
   * Default is 100 if not specified.
   */
  priority?: number
}
