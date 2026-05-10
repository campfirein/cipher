import type {ICipherAgent} from '../../../../agent/core/interfaces/i-cipher-agent.js'
import type {LlmUsage} from '../../domain/entities/llm-usage.js'
import type {
  QueryLogMatchedDoc,
  QueryLogSearchMetadata,
  QueryLogTier,
  QueryLogTiming,
} from '../../domain/entities/query-log-entry.js'

/**
 * Options for executing query with an injected agent.
 * Agent uses its default session (Single-Session pattern).
 */
export interface QueryExecuteOptions {
  /** Query content to search in context tree */
  query: string
  /** Task ID for event routing (required for concurrent task isolation) */
  taskId: string
  /**
   * Optional per-task usage aggregator. When provided, the executor reads
   * its rolled-up totals at completion and writes them to the result. The
   * caller is responsible for subscribing the aggregator to the agent's
   * `llmservice:usage` event stream (TODO: agent-process integration).
   *
   */
  usageAggregator?: import('../../../infra/telemetry/task-usage-aggregator.js').TaskUsageAggregator
  /** Stable workspace root for scoping search and cache isolation */
  worktreeRoot?: string
}

/**
 * Structured result from QueryExecutor containing the response string
 * plus metadata about how the query was resolved.
 *
 * Consumed by QueryLogHandler (ENG-1893) to persist
 * query log entries with telemetry (token counts, latency tiers, format).
 */
export type QueryExecutorResult = {
  /**
   * Format mode of the docs the recall touched. `'html'` if any retrieved
   * file is HTML, otherwise `'markdown'`. Undefined when no files were
   * retrieved (Tier 0/1 cache hits, Tier 4 LLM-only).
   */
  format?: 'html' | 'markdown'
  /** Documents matched during search (empty for cache hits) */
  matchedDocs: QueryLogMatchedDoc[]
  /** The response string (includes attribution footer) */
  response: string
  /** Search statistics (undefined for cache-only tiers 0/1) */
  searchMetadata?: QueryLogSearchMetadata
  /** Resolution tier: 0=exact cache, 1=fuzzy cache, 2=direct search, 3=optimized LLM, 4=full agentic */
  tier: QueryLogTier
  /**
   * Wall-clock timing. `durationMs` mirrors `totalMs` for back-compat;
   * `searchMs` / `llmMs` / `totalMs` are the canonical fields.
   */
  timing: QueryLogTiming & {durationMs: number}
  /**
   * Token usage rolled up across all sub-LLM calls in the recall.
   * Undefined for tiers that ran no LLM call (Tier 0/1/2).
   */
  usage?: LlmUsage
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
   * @returns Structured result with response, tier, timing, and search metadata
   */
  executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptions): Promise<QueryExecutorResult>
}
