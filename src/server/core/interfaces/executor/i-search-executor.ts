import type {SearchKnowledgeResult} from '../../../../agent/infra/sandbox/tools-sdk.js'

/**
 * Options for executing a context tree search.
 * Search is stateless — no agent session, no LLM, no task isolation needed.
 */
export interface SearchExecuteOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number
  /** Search query */
  query: string
  /** Path prefix to scope results (e.g. "auth/" for auth domain only) */
  scope?: string
}

/**
 * ISearchExecutor - Executes search against the context tree's BM25 index.
 *
 * Unlike QueryExecutor (which requires a CipherAgent for LLM synthesis),
 * SearchExecutor is stateless and returns raw search results directly.
 * No agent session, no sandbox, no LLM call.
 *
 * Architecture:
 * - SearchKnowledgeService provides BM25-indexed search
 * - Executor wraps it with option validation
 * - Results are SearchKnowledgeResult (paths, scores, excerpts)
 */
export interface ISearchExecutor {
  /**
   * Execute a context tree search.
   *
   * @param options - Search options (query, limit, scope)
   * @returns Raw search results with paths, scores, and excerpts
   */
  execute(options: SearchExecuteOptions): Promise<SearchKnowledgeResult>
}
