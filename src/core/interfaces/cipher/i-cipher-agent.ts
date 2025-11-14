/**
 * Agent state information
 */
export interface AgentState {
  currentIteration: number
  executionHistory: string[]
}

/**
 * Interface for the CipherAgent
 * Provides an agentic execution layer on top of the LLM service
 */
export interface ICipherAgent {
  /**
   * Execute the agent with user input
   * @param input - User input string
   * @returns Agent response
   */
  execute(input: string): Promise<string>

  /**
   * Get current agent state
   * @returns Current state information
   */
  getState(): AgentState

  /**
   * Reset the agent to initial state
   * Clears execution history and resets iteration counter
   */
  reset(): void

  /**
   * Start the agent - initializes all services asynchronously
   * Must be called before execute()
   */
  start(): Promise<void>
}
