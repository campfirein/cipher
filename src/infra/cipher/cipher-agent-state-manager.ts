import type {TerminationReason} from '../../core/domain/cipher/agent/agent-state.js'
import type {AgentExecutionState, AgentState} from '../../core/interfaces/cipher/i-cipher-agent.js'

/**
 * Manages the runtime state of the CipherAgent.
 *
 * Enhanced to track execution state, termination reasons, timing,
 * and tool metrics following gemini-cli patterns. Maintains backward
 * compatibility with legacy fields (executionHistory).
 */
export class CipherAgentStateManager {
  private currentIteration: number = 0
  private durationMs?: number
  private endTime?: Date
  private executionHistory: string[] = []
  private executionState: AgentExecutionState = 'idle'
  private startTime?: Date
  private terminationReason?: TerminationReason
  private toolCallsExecuted: number = 0

  /**
   * Add an execution record to history (legacy method).
   * @param record - Execution record to add
   */
  public addExecutionRecord(record: string): void {
    this.executionHistory.push(record)
  }

  /**
   * Mark execution as complete with reason.
   * @param reason - Why execution terminated
   */
  public complete(reason: TerminationReason): void {
    this.executionState = 'complete'
    this.terminationReason = reason
    this.endTime = new Date()
    if (this.startTime) {
      this.durationMs = this.endTime.getTime() - this.startTime.getTime()
    }
  }

  /**
   * Mark execution as errored.
   * @param reason - Error termination reason
   */
  public fail(reason: TerminationReason): void {
    this.executionState = 'error'
    this.terminationReason = reason
    this.endTime = new Date()
    if (this.startTime) {
      this.durationMs = this.endTime.getTime() - this.startTime.getTime()
    }
  }

  /**
   * Get the current state.
   * @returns Current agent state with all enhanced fields
   */
  public getState(): AgentState {
    return {
      currentIteration: this.currentIteration,
      durationMs: this.durationMs,
      endTime: this.endTime,
      executionHistory: [...this.executionHistory],
      executionState: this.executionState,
      startTime: this.startTime,
      terminationReason: this.terminationReason,
      toolCallsExecuted: this.toolCallsExecuted,
    }
  }

  /**
   * Increment the iteration counter.
   * @returns The new iteration count
   */
  public incrementIteration(): number {
    this.currentIteration++
    return this.currentIteration
  }

  /**
   * Increment the tool calls counter.
   * @returns The new tool calls count
   */
  public incrementToolCalls(): number {
    this.toolCallsExecuted++
    return this.toolCallsExecuted
  }

  /**
   * Reset the state to initial values.
   */
  public reset(): void {
    this.currentIteration = 0
    this.durationMs = undefined
    this.endTime = undefined
    this.executionHistory = []
    this.executionState = 'idle'
    this.startTime = undefined
    this.terminationReason = undefined
    this.toolCallsExecuted = 0
  }

  /**
   * Set the current execution state.
   * @param state - New execution state
   */
  public setExecutionState(state: AgentExecutionState): void {
    this.executionState = state
  }

  /**
   * Start execution tracking.
   * Sets startTime and transitions to executing state.
   */
  public startExecution(): void {
    this.startTime = new Date()
    this.executionState = 'executing'
  }
}
