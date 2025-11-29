/**
 * Agent State Machine
 *
 * Implements a finite state machine for agent execution, following gemini-cli patterns.
 * Manages state transitions, termination checks, and execution metrics.
 *
 * State Transitions:
 * - IDLE → EXECUTING (start execution)
 * - EXECUTING → TOOL_CALLING (tool calls in response)
 * - EXECUTING → COMPLETE (no tool calls, task done)
 * - EXECUTING → ERROR (execution failed)
 * - EXECUTING → ABORTED (externally cancelled)
 * - TOOL_CALLING → EXECUTING (tools executed, continue)
 * - TOOL_CALLING → ERROR (tool execution failed)
 * - TOOL_CALLING → ABORTED (externally cancelled)
 */

import {AgentExecutionContext, AgentState, TerminationReason} from './agent-state.js'

/**
 * Valid state transitions for the agent FSM.
 * Each state maps to an array of valid target states.
 */
const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.ABORTED]: [],
  [AgentState.COMPLETE]: [],
  [AgentState.ERROR]: [],
  [AgentState.EXECUTING]: [AgentState.TOOL_CALLING, AgentState.COMPLETE, AgentState.ERROR, AgentState.ABORTED],
  [AgentState.IDLE]: [AgentState.EXECUTING],
  [AgentState.TOOL_CALLING]: [AgentState.EXECUTING, AgentState.ERROR, AgentState.ABORTED],
}

/**
 * Agent State Machine.
 *
 * Manages the execution state of an agent, including:
 * - State transitions with validation
 * - Termination condition checks (timeout, max turns)
 * - Execution metrics (turn count, tool calls)
 *
 * @example
 * ```typescript
 * const sm = new AgentStateMachine(50, 600_000) // 50 turns, 10 min timeout
 * sm.transition(AgentState.EXECUTING)
 *
 * while (!sm.isTerminal()) {
 *   const reason = sm.shouldTerminate()
 *   if (reason) break
 *
 *   // Execute iteration...
 *   sm.incrementTurn()
 * }
 *
 * sm.complete() // or sm.fail(error) or sm.abort()
 * ```
 */
export class AgentStateMachine {
  private context: AgentExecutionContext
  private state: AgentState = AgentState.IDLE

  /**
   * Create a new agent state machine.
   *
   * @param maxTurns - Maximum number of turns before MAX_TURNS termination
   * @param maxTimeMs - Maximum execution time in milliseconds before TIMEOUT
   */
  constructor(
    private readonly maxTurns: number,
    private readonly maxTimeMs: number,
  ) {
    this.context = {
      startTime: new Date(),
      state: AgentState.IDLE,
      toolCallsExecuted: 0,
      turnCount: 0,
    }
  }

  /**
   * Abort the execution externally.
   *
   * Transitions to ABORTED state and sets termination reason.
   * Can be called from any non-terminal state.
   */
  abort(): void {
    this.transition(AgentState.ABORTED)
    this.context.terminationReason = TerminationReason.ABORTED
  }

  /**
   * Complete the execution successfully.
   *
   * Transitions to COMPLETE state and sets GOAL as termination reason.
   * Should be called when the LLM returns a response without tool calls.
   */
  complete(): void {
    this.transition(AgentState.COMPLETE)
    this.context.terminationReason = TerminationReason.GOAL
  }

  /**
   * Fail the execution with an error.
   *
   * Transitions to ERROR state and stores the error.
   * Should be called when an unrecoverable error occurs.
   *
   * @param error - The error that caused the failure
   */
  fail(error: Error): void {
    this.transition(AgentState.ERROR)
    this.context.terminationReason = TerminationReason.ERROR
    this.context.lastError = error
  }

  /**
   * Get a readonly copy of the current execution context.
   *
   * @returns Copy of the execution context
   */
  getContext(): Readonly<AgentExecutionContext> {
    return {...this.context}
  }

  /**
   * Get the current state.
   *
   * @returns Current agent state
   */
  getState(): AgentState {
    return this.state
  }

  /**
   * Increment the turn counter.
   *
   * Should be called after each iteration of the agentic loop.
   */
  incrementTurn(): void {
    this.context.turnCount++
  }

  /**
   * Check if the state machine is in a terminal state.
   *
   * Terminal states are: COMPLETE, ERROR, ABORTED
   *
   * @returns True if in a terminal state
   */
  isTerminal(): boolean {
    return [AgentState.ABORTED, AgentState.COMPLETE, AgentState.ERROR].includes(this.state)
  }

  /**
   * Record a tool call execution.
   *
   * Should be called after each tool is executed.
   */
  recordToolCall(): void {
    this.context.toolCallsExecuted++
  }

  /**
   * Check if the execution should terminate.
   *
   * Checks for:
   * - MAX_TURNS: Turn count >= maxTurns
   * - TIMEOUT: Elapsed time > maxTimeMs
   *
   * @returns Termination reason if should terminate, null otherwise
   */
  shouldTerminate(): null | TerminationReason {
    if (this.context.turnCount >= this.maxTurns) {
      return TerminationReason.MAX_TURNS
    }

    if (Date.now() - this.context.startTime.getTime() > this.maxTimeMs) {
      return TerminationReason.TIMEOUT
    }

    return null
  }

  /**
   * Transition to a new state.
   *
   * Validates the transition is allowed, then updates the state.
   *
   * @param newState - Target state
   * @throws Error if the transition is not valid
   */
  transition(newState: AgentState): void {
    if (!VALID_TRANSITIONS[this.state].includes(newState)) {
      throw new Error(`Invalid state transition: ${this.state} → ${newState}`)
    }

    this.state = newState
    this.context.state = newState
  }
}
