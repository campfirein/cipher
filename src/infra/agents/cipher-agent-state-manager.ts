import type {AgentState} from '../../core/interfaces/i-cipher-agent.js'

/**
 * Manages the runtime state of the CipherAgent
 * Tracks execution iterations and history
 */
export class CipherAgentStateManager {
  private currentIteration: number = 0
  private executionHistory: string[] = []

  /**
   * Add an execution record to history
   * @param record - Execution record to add
   */
  public addExecutionRecord(record: string): void {
    this.executionHistory.push(record)
  }

  /**
   * Get the current state
   * @returns Current agent state
   */
  public getState(): AgentState {
    return {
      currentIteration: this.currentIteration,
      executionHistory: [...this.executionHistory],
    }
  }

  /**
   * Increment the iteration counter
   * @returns The new iteration count
   */
  public incrementIteration(): number {
    this.currentIteration++
    return this.currentIteration
  }

  /**
   * Reset the state to initial values
   */
  public reset(): void {
    this.currentIteration = 0
    this.executionHistory = []
  }
}
