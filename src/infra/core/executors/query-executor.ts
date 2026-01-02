import type {ICipherAgent} from '../../../core/interfaces/cipher/i-cipher-agent.js'
import type {IQueryExecutor, QueryExecuteOptions} from '../../../core/interfaces/executor/i-query-executor.js'

import {getAgentStorage} from '../../cipher/storage/agent-storage.js'

/**
 * QueryExecutor - Executes query tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with query-specific options.
 *
 * Architecture:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
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

    // Initialize storage for execution tracking
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      // Create execution with status='running'
      executionId = storage.createExecution('query', query)

      // Execute with query commandType
      // Agent uses its default session (created during start())
      const prompt = `Search the context tree for: ${query}`
      const response = await agent.execute(prompt, {
        executionContext: {commandType: 'query'},
        taskId,
      })

      // Mark execution as completed
      storage.updateExecutionStatus(executionId, 'completed', response)

      // Cleanup old executions
      storage.cleanupOldExecutions(100)

      return response
    } catch (error) {
      // Mark execution as failed
      if (executionId) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        storage.updateExecutionStatus(executionId, 'failed', undefined, errorMessage)
      }

      throw error
    }
  }
}
