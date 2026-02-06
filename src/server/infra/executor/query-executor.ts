import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {IQueryExecutor, QueryExecuteOptions} from '../../core/interfaces/executor/i-query-executor.js'

/**
 * QueryExecutor - Executes query tasks with an injected CipherAgent.
 *
 * This is NOT a UseCase (which orchestrates business logic).
 * It's an Executor that wraps agent.execute() with query-specific options.
 *
 * Architecture:
 * - AgentProcess injects the long-lived CipherAgent
 * - Event streaming is handled by agent-process (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Executor focuses solely on query execution
 *
 * Uses code_exec with tools.* SDK for programmatic search.
 */
export class QueryExecutor implements IQueryExecutor {
  public async executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptions): Promise<string> {
    const {query, taskId} = options

    // Execute with query commandType
    // Agent uses its default session (created during start())
    // Task lifecycle is managed by Transport (task:started, task:completed, task:error)
    const prompt = this.buildQueryPrompt(query)
    const response = await agent.execute(prompt, {
      executionContext: {commandType: 'query'},
      taskId,
    })

    return response
  }

  /**
   * Build a streamlined query prompt optimized for fast, accurate responses.
   *
   * Uses code_exec with tools.* SDK for programmatic search.
   * Designed to minimize iterations while maintaining answer quality.
   */
  private buildQueryPrompt(query: string): string {
    return `## User Query
${query}

## Instructions

Search the context tree (.brv/context-tree/) to answer this question.
Use \`code_exec\` to run a programmatic search with the \`tools.*\` SDK.

### Response Format
- **Summary**: Direct answer (2-3 sentences)
- **Details**: Key findings with explanations
- **Sources**: File paths from .brv/context-tree/
- **Gaps**: Note any aspects not covered`
  }
}
