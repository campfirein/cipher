import type {ICipherAgent} from '../cipher/i-cipher-agent.js'

/**
 * Options for REPL-style execution (with terminal output).
 */
export interface QueryUseCaseRunOptions {
  apiKey?: string
  model?: string
  query: string
  verbose?: boolean
}

/**
 * Options for executing with an injected agent (v0.5.0 architecture).
 */
export interface QueryExecuteOptions {
  /** Query content */
  query: string
}

export interface IQueryUseCase {
  /**
   * Execute with an injected agent (v0.5.0 architecture).
   * UseCase receives agent from TaskProcessor, doesn't manage agent lifecycle.
   * Event streaming handled by agent-worker (subscribes to agentEventBus).
   *
   * @param agent - Long-lived CipherAgent
   * @param options - Execution options (query)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptions): Promise<string>

  /**
   * Run in REPL mode (with terminal output).
   */
  run(options: QueryUseCaseRunOptions): Promise<void>
}
