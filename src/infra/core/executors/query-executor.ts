import type {ICipherAgent} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {IQueryExecutor, QueryExecuteOptions} from '../../../core/interfaces/executor/i-query-executor.js'

/**
 * QueryExecutor - Executes query tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with query-specific options.
 *
 * Architecture:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Executor focuses solely on query execution
 */
export class QueryExecutor implements IQueryExecutor {
  /**
   * Execute query with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (query)
   * @returns Result string from agent execution
   */
  public async executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptions): Promise<string> {
    const {query, taskId} = options

    // Execute with query commandType
    // Agent uses its default session (created during start())
    // Task lifecycle is managed by Transport (task:started, task:completed, task:error)
    const prompt = `Search the context tree for: ${query}`
    const response = await agent.execute(prompt, {
      executionContext: {commandType: 'query'},
      taskId,
    })

    return response
  }
}
