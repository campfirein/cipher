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
 * Enhanced with multi-perspective search strategy for comprehensive results.
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
   * Build an enhanced query prompt with multi-perspective search instructions.
   *
   * The prompt instructs the agent to:
   * 1. Analyze the query to understand intent
   * 2. Generate 2-3 search perspectives for comprehensive coverage
   * 3. Execute searches using the task tool with explore subagents
   * 4. Synthesize results into a cohesive answer with citations
   */
  private buildQueryPrompt(query: string): string {
    return `## User Query
${query}

## Query Processing Instructions

You are searching the context tree to answer the user's question. Follow this strategy for comprehensive results:

### Step 1: Query Analysis
First, analyze the query:
- What is the user trying to learn? (core intent)
- What are the key concepts mentioned?
- Is this a factual, analytical, or exploratory question?

### Step 2: Multi-Perspective Search
Generate 2-3 complementary search perspectives:

1. **Direct Search**: Use exact terms from the query
2. **Related Concepts**: Search for synonyms, related terms, technical jargon
3. **Implementation Patterns**: Search for how things are used or implemented

### Step 3: Execute Parallel Searches
Use the \`task\` tool to spawn explore subagents for each perspective:
- Each subagent focuses on ONE search angle
- Use \`contextTreeOnly=true\` to search only the context tree
- Provide clear, specific search instructions

Example:
\`\`\`
task(
  subagentType="explore",
  description="Search [perspective]",
  prompt="Search for [specific terms]. Look in .brv/context-tree/ for [what to find].",
  contextTreeOnly=true
)
\`\`\`

### Step 4: Synthesize Results
After gathering information:
1. Identify overlapping findings (likely most relevant)
2. Combine unique insights from each perspective
3. Provide a clear, organized answer
4. Cite sources with file paths

### Response Format
- **Summary**: Brief answer (2-3 sentences)
- **Details**: Expanded explanation with findings
- **Sources**: File paths for referenced information
- **Gaps**: Note any aspects that couldn't be answered`
  }
}
