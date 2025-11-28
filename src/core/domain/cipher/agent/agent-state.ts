/**
 * Agent State Types
 *
 * Defines the state machine for agent execution, following gemini-cli patterns.
 * Provides explicit states and termination reasons for better observability
 * and control over the agentic loop.
 */

/**
 * Agent execution states.
 *
 * These states represent the current phase of agent execution:
 * - IDLE: Not executing, waiting for input
 * - EXECUTING: Processing LLM response
 * - TOOL_CALLING: Executing tool calls
 * - COMPLETE: Task finished successfully
 * - ERROR: Terminated with error
 * - ABORTED: Externally cancelled
 */
export enum AgentState {
  /** Externally cancelled */
  ABORTED = 'ABORTED',

  /** Task finished successfully */
  COMPLETE = 'COMPLETE',

  /** Terminated with error */
  ERROR = 'ERROR',

  /** Processing LLM response */
  EXECUTING = 'EXECUTING',

  /** Not executing, waiting for input */
  IDLE = 'IDLE',

  /** Executing tool calls */
  TOOL_CALLING = 'TOOL_CALLING',
}

/**
 * Termination reasons for agent execution.
 *
 * When an agent stops executing, one of these reasons explains why:
 * - GOAL: Task completed successfully (no more tool calls)
 * - TIMEOUT: Max execution time exceeded
 * - MAX_TURNS: Iteration limit reached
 * - ERROR: Unexpected failure during execution
 * - ABORTED: External cancellation (e.g., abort signal)
 * - PROTOCOL_VIOLATION: Invalid state transition or response
 */
export enum TerminationReason {
  /** External cancellation (e.g., abort signal) */
  ABORTED = 'ABORTED',

  /** Unexpected failure during execution */
  ERROR = 'ERROR',

  /** Task completed successfully (no tool calls in response) */
  GOAL = 'GOAL',

  /** Iteration limit reached */
  MAX_TURNS = 'MAX_TURNS',

  /** Invalid state transition or malformed response */
  PROTOCOL_VIOLATION = 'PROTOCOL_VIOLATION',

  /** Max execution time exceeded */
  TIMEOUT = 'TIMEOUT',
}

/**
 * Execution context with state tracking.
 *
 * Captures the current state and metrics of an agent execution,
 * including timing, turn count, and tool call statistics.
 */
export interface AgentExecutionContext {
  /** Last error if terminated with ERROR */
  lastError?: Error

  /** When this execution started */
  startTime: Date

  /** Current state of the agent */
  state: AgentState

  /** Why the execution terminated (if complete) */
  terminationReason?: TerminationReason

  /** Number of tool calls executed */
  toolCallsExecuted: number

  /** Number of turns (iterations) completed */
  turnCount: number
}
