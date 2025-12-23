import {randomUUID} from 'node:crypto'

import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {IQueryUseCaseV2, QueryExecuteOptionsV2} from '../../core/interfaces/usecase/i-query-use-case-v2.js'

import {getAgentStorage} from '../cipher/storage/agent-storage.js'

/**
 * QueryUseCaseV2 - Simplified query use case for v0.5.0 architecture.
 *
 * Key differences from v1:
 * - Only executeWithAgent method (no run() for REPL mode)
 * - No terminal/tracking dependencies (handled by caller)
 * - Pure business logic execution
 *
 * This class is designed for Transport-based task execution where:
 * - TaskProcessor injects the long-lived CipherAgent
 * - Event streaming is handled by agent-worker (subscribes to agentEventBus)
 * - UseCase focuses solely on query business logic
 */
export class QueryUseCaseV2 implements IQueryUseCaseV2 {
  /**
   * Execute query with an injected agent.
   *
   * @param agent - Long-lived CipherAgent (managed by caller)
   * @param options - Execution options (query)
   * @returns Result string from agent execution
   */
  public async executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptionsV2): Promise<string> {
    const {query, taskId} = options

    // Initialize storage for execution tracking
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      // Create execution with status='running'
      executionId = storage.createExecution('query', query)

      // Execute with query commandType
      // Agent uses its default session (created during start())
      const trackingRequestId = randomUUID()
      const prompt = `Search the context tree for: ${query}`
      const response = await agent.execute(prompt, {
        executionContext: {commandType: 'query'},
        taskId,
        trackingRequestId,
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
