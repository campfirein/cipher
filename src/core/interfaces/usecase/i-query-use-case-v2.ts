import type {ICipherAgent} from '../cipher/i-cipher-agent.js'

/**
 * Options for executing query with an injected agent (v0.5.0 architecture).
 * Agent uses its default session (Single-Session pattern).
 */
export interface QueryExecuteOptionsV2 {
  /** Query content to search in context tree */
  query: string
}

/**
 * IQueryUseCaseV2 - Simplified query use case for v0.5.0 architecture.
 *
 * Key differences from v1:
 * - Only executeWithAgent method (no run() for REPL mode)
 * - No terminal/tracking dependencies (handled by caller)
 * - Pure business logic execution
 *
 * This interface is designed for Transport-based task execution where:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - UseCase focuses solely on query business logic
 */
export interface IQueryUseCaseV2 {
  /**
   * Execute query with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (query)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptionsV2): Promise<string>
}
