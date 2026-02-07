import { join } from 'node:path'

import type { ICipherAgent } from '../../../agent/core/interfaces/i-cipher-agent.js'
import type { IFileSystem } from '../../../agent/core/interfaces/i-file-system.js'
import type { ISearchKnowledgeService } from '../../../agent/infra/sandbox/tools-sdk.js'
import type { IQueryExecutor, QueryExecuteOptions } from '../../core/interfaces/executor/i-query-executor.js'

import { BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR } from '../../constants.js'
import { QueryResultCache } from './query-result-cache.js'

/** Minimum MiniSearch score to consider a result high-confidence for pre-fetching */
const SMART_ROUTING_SCORE_THRESHOLD = 5

/** Maximum number of documents to pre-fetch and inject into the prompt */
const SMART_ROUTING_MAX_DOCS = 5

/**
 * Optional dependencies for QueryExecutor.
 * All fields are optional — without them, the executor falls back to the original behavior.
 */
export interface QueryExecutorDeps {
  /** Enable query result caching (default: false) */
  enableCache?: boolean
  /** File system for reading full document content and computing fingerprints */
  fileSystem?: IFileSystem
  /** Search service for pre-fetching relevant context before calling the LLM */
  searchService?: ISearchKnowledgeService
}

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
 * Optimizations:
 * - Smart routing: pre-fetches context via SearchKnowledgeService to reduce LLM round-trips
 * - Query result caching: caches responses with context tree fingerprint validation
 */
export class QueryExecutor implements IQueryExecutor {
  private readonly cache?: QueryResultCache
  private readonly fileSystem?: IFileSystem
  private readonly searchService?: ISearchKnowledgeService

  constructor(deps?: QueryExecutorDeps) {
    this.fileSystem = deps?.fileSystem
    this.searchService = deps?.searchService
    if (deps?.enableCache) {
      this.cache = new QueryResultCache()
    }
  }

  public async executeWithAgent(agent: ICipherAgent, options: QueryExecuteOptions): Promise<string> {
    const { query, taskId } = options

    // Step 1: Check query result cache (if enabled)
    let fingerprint: string | undefined
    if (this.cache && this.fileSystem) {
      fingerprint = await this.computeContextTreeFingerprint()
      const cached = this.cache.get(query, fingerprint)
      if (cached) {
        return cached
      }
    }

    // Step 2: Smart routing — pre-fetch context from knowledge base
    let prefetchedContext: string | undefined
    if (this.searchService) {
      prefetchedContext = await this.prefetchContext(query)
    }

    // Step 3: Build prompt and execute with LLM
    const prompt = this.buildQueryPrompt(query, prefetchedContext)
    const response = await agent.execute(prompt, {
      executionContext: { commandType: 'query' },
      taskId,
    })

    // Step 4: Store result in cache (if enabled)
    if (this.cache && fingerprint) {
      this.cache.set(query, response, fingerprint)
    }

    return response
  }

  /**
   * Build a streamlined query prompt optimized for fast, accurate responses.
   *
   * When pre-fetched context is available, the prompt instructs the LLM to answer
   * directly from the provided context (reducing LLM calls from 2+ to 1).
   * When no context is available, falls back to tool-based search.
   */
  private buildQueryPrompt(query: string, prefetchedContext?: string): string {
    if (prefetchedContext) {
      return `## User Query
${query}

## Pre-fetched Context
The following relevant knowledge was found in the context tree:

${prefetchedContext}

## Instructions

Answer the user's question using the pre-fetched context above.
If the context is insufficient, you may use \`code_exec\` with the \`tools.*\` SDK for additional searches.

### Response Format
- **Summary**: Direct answer (2-3 sentences)
- **Details**: Key findings with explanations
- **Sources**: File paths from .brv/context-tree/
- **Gaps**: Note any aspects not covered`
    }

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

  /**
   * Compute a context tree fingerprint cheaply using file mtimes.
   * Used for cache invalidation — if any file in the context tree changes,
   * the fingerprint changes and cached results are invalidated.
   */
  private async computeContextTreeFingerprint(): Promise<string> {
    try {
      const contextTreePath = join(BRV_DIR, CONTEXT_TREE_DIR)
      const globResult = await this.fileSystem!.globFiles(`**/*${CONTEXT_FILE_EXTENSION}`, {
        cwd: contextTreePath,
        includeMetadata: true,
        maxResults: 10_000,
        respectGitignore: false,
      })

      const files = globResult.files.map((f) => ({
        mtime: f.modified?.getTime() ?? 0,
        path: f.path,
      }))

      return QueryResultCache.computeFingerprint(files)
    } catch {
      return 'unknown'
    }
  }

  /**
   * Pre-fetch relevant context from the knowledge base before calling the LLM.
   * Returns formatted context string if high-confidence results are found,
   * or undefined to fall back to tool-based search.
   */
  private async prefetchContext(query: string): Promise<string | undefined> {
    try {
      const searchResult = await this.searchService!.search(query, { limit: SMART_ROUTING_MAX_DOCS })

      if (searchResult.totalFound === 0) {
        return undefined
      }

      // Filter to high-confidence results only
      const highConfidenceResults = searchResult.results.filter(
        (r) => r.score >= SMART_ROUTING_SCORE_THRESHOLD,
      )

      if (highConfidenceResults.length === 0) {
        return undefined
      }

      // Read full content for high-confidence results
      const fullDocs = await Promise.all(
        highConfidenceResults.map(async (result) => {
          if (this.fileSystem) {
            try {
              const contextTreePath = join(BRV_DIR, CONTEXT_TREE_DIR, result.path)
              const { content } = await this.fileSystem.readFile(contextTreePath)
              return { content, path: result.path, title: result.title }
            } catch {
              // Fall back to excerpt if full read fails
              return { content: result.excerpt, path: result.path, title: result.title }
            }
          }

          return { content: result.excerpt, path: result.path, title: result.title }
        }),
      )

      const sections = fullDocs.map(
        (doc) => `### ${doc.title}\n**Source**: .brv/context-tree/${doc.path}\n\n${doc.content}`,
      )

      return sections.join('\n\n---\n\n')
    } catch {
      // If pre-fetch fails for any reason, fall back to normal tool-based search
      return undefined
    }
  }
}
