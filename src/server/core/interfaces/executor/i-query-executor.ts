import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'

/**
 * Options for executing query with an injected agent.
 * Agent uses its default session (Single-Session pattern).
 */
export interface QueryExecuteOptions {
  /** Query content to search in context tree */
  query: string
  /** Task ID for event routing (required for concurrent task isolation) */
  taskId: string
  /** Stable workspace root for scoping search and cache isolation */
  workspaceRoot?: string
}

/**
 * IQueryExecutor - Executes query tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with query-specific options.
 *
 * Architecture:
 * - AgentProcess injects the long-lived CipherAgent
 * - Event streaming is handled by agent-process (subscribes to agentEventBus)
 * - Executor focuses solely on query execution
 */
export interface IQueryExecutor {
  /**
   * Execute query with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (query)
   * @returns Result string from agent execution
   */
  executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptions): Promise<string>
}
