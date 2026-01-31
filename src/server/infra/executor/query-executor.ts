import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {IQueryExecutor, QueryExecuteOptions} from '../../core/interfaces/executor/i-query-executor.js'

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
 *
 * Uses search_knowledge as the primary tool for fast knowledge retrieval.
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
   * Uses search_knowledge as primary tool with optional read_file for details.
   * Designed to minimize iterations while maintaining answer quality.
   */
  private buildQueryPrompt(query: string): string {
    return `## User Query
${query}

## Instructions

Search the context tree (.brv/context-tree/) to answer this question.

### Strategy
1. Use \`search_knowledge\` with natural language to find relevant topics
2. If excerpts provide sufficient context, answer immediately
3. Only use \`read_file\` if you need full content from specific files

### Response Format
- **Summary**: Direct answer (2-3 sentences)
- **Details**: Key findings with explanations
- **Sources**: File paths from .brv/context-tree/
- **Gaps**: Note any aspects not covered in the knowledge base`
  }
}
