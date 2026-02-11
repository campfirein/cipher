import { join } from 'node:path'

import type { ICipherAgent } from '../../../agent/core/interfaces/i-cipher-agent.js'
import type { IFileSystem } from '../../../agent/core/interfaces/i-file-system.js'
import type { ISearchKnowledgeService, SearchKnowledgeResult } from '../../../agent/infra/sandbox/tools-sdk.js'
import type { IQueryExecutor, QueryExecuteOptions } from '../../core/interfaces/executor/i-query-executor.js'

import { BRV_DIR, CONTEXT_FILE_EXTENSION, CONTEXT_TREE_DIR } from '../../constants.js'
import {
  canRespondDirectly,
  type DirectSearchResult,
  formatDirectResponse,
  formatNotFoundResponse,
} from './direct-search-responder.js'
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
 * - AgentProcess injects the long-lived CipherAgent
 * - Event streaming is handled by agent-process (subscribes to agentEventBus)
 * - Transport handles task lifecycle (task:started, task:completed, task:error)
 * - Executor focuses solely on query execution
 *
 * Tiered response strategy (fastest to slowest):
 * - Tier 0: Exact cache hit (0ms)
 * - Tier 1: Fuzzy cache match via Jaccard similarity (~50ms)
 * - Tier 2: Direct search response without LLM (~100-200ms)
 * - Tier 3: Optimized single LLM call with pre-fetched context (<5s)
 * - Tier 4: Full agentic loop fallback (8-15s)
 */
export class QueryExecutor implements IQueryExecutor {
  private static readonly FINGERPRINT_CACHE_TTL_MS = 30_000
  private readonly cache?: QueryResultCache
  private cachedFingerprint?: { expiresAt: number; value: string }
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

    // Start search early — runs in parallel with fingerprint computation (independent operations)
    const searchPromise = this.searchService?.search(query, { limit: SMART_ROUTING_MAX_DOCS })
    // Prevent unhandled rejection if we return early (cache hit) while search is still pending
    searchPromise?.catch(() => {})

    // === Tier 0: Exact cache hit (0ms) ===
    let fingerprint: string | undefined
    if (this.cache && this.fileSystem) {
      fingerprint = await this.computeContextTreeFingerprint()
      const cached = this.cache.get(query, fingerprint)
      if (cached) {
        return cached
      }
    }

    // === Tier 1: Fuzzy cache match (~50ms) ===
    if (this.cache && fingerprint) {
      const fuzzyHit = this.cache.findSimilar(query, fingerprint)
      if (fuzzyHit) {
        return fuzzyHit
      }
    }

    // Await search result (already started in parallel with fingerprint computation)
    let searchResult: SearchKnowledgeResult | undefined
    try {
      searchResult = await searchPromise
    } catch {
      // Search failed, proceed without pre-fetched context
    }

    // === OOD short-circuit: no results means topic not covered ===
    if (searchResult && searchResult.results.length === 0) {
      const response = formatNotFoundResponse(query)
      if (this.cache && fingerprint) {
        this.cache.set(query, response, fingerprint)
      }

      return response
    }

    // === Tier 2: Direct search response (~100-200ms) ===
    if (searchResult && this.fileSystem) {
      const directResult = await this.tryDirectSearchResponse(query, searchResult)
      if (directResult) {
        if (this.cache && fingerprint) {
          this.cache.set(query, directResult, fingerprint)
        }

        return directResult
      }
    }

    // === Tier 3: Optimized LLM call with pre-fetched context (<5s) ===
    let prefetchedContext: string | undefined
    if (searchResult && this.fileSystem) {
      prefetchedContext = this.buildPrefetchedContext(searchResult)
    }

    const prompt = this.buildQueryPrompt(query, prefetchedContext)

    // Query-optimized LLM overrides: fewer tokens, iterations, and lower temperature
    const queryOverrides = prefetchedContext
      ? { maxIterations: 2, maxTokens: 1024, temperature: 0.3 }
      : { maxIterations: 3, maxTokens: 2048, temperature: 0.5 }

    const response = await agent.execute(prompt, {
      executionContext: { commandType: 'query', ...queryOverrides },
      taskId,
    })

    // Store in cache for future Tier 0/1 hits
    if (this.cache && fingerprint) {
      this.cache.set(query, response, fingerprint)
    }

    return response
  }

  /**
   * Build pre-fetched context string from search results for LLM prompt injection.
   * Synchronous — uses already-fetched search results (no additional I/O for excerpts).
   * Full document reads happen only for high-confidence results.
   */
  private buildPrefetchedContext(searchResult: SearchKnowledgeResult): string | undefined {
    if (searchResult.totalFound === 0) return undefined

    const highConfidenceResults = searchResult.results.filter(
      (r) => r.score >= SMART_ROUTING_SCORE_THRESHOLD,
    )

    if (highConfidenceResults.length === 0) return undefined

    const sections = highConfidenceResults.map(
      (r) => `### ${r.title}\n**Source**: .brv/context-tree/${r.path}\n\n${r.excerpt}`,
    )

    return sections.join('\n\n---\n\n')
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
If the pre-fetched context does not directly address the user's query topic, respond that the topic is not covered in the knowledge base. Do not attempt to answer from tangentially related content.
If the context is insufficient but relevant, you may use \`code_exec\` with the \`tools.*\` SDK for additional searches.

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
    // Fast path: return cached fingerprint if still valid (avoids globFiles I/O)
    if (this.cachedFingerprint && Date.now() < this.cachedFingerprint.expiresAt) {
      return this.cachedFingerprint.value
    }

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

      const fingerprint = QueryResultCache.computeFingerprint(files)
      this.cachedFingerprint = {
        expiresAt: Date.now() + QueryExecutor.FINGERPRINT_CACHE_TTL_MS,
        value: fingerprint,
      }
      return fingerprint
    } catch {
      return 'unknown'
    }
  }

  /**
   * Attempt to produce a direct response from search results without LLM.
   * Returns formatted response if high-confidence dominant match found, undefined otherwise.
   *
   * Uses higher thresholds than smart routing (score >= 8, 2x dominance)
   * to ensure only clearly answerable queries bypass the LLM.
   */
  private async tryDirectSearchResponse(
    query: string,
    searchResult: SearchKnowledgeResult,
  ): Promise<string | undefined> {
    try {
      if (searchResult.totalFound === 0) return undefined

      // Build full results with content
      const fullResults: DirectSearchResult[] = await Promise.all(
        searchResult.results
          .filter((r) => r.score >= SMART_ROUTING_SCORE_THRESHOLD)
          .slice(0, SMART_ROUTING_MAX_DOCS)
          .map(async (result) => {
            let content = result.excerpt
            try {
              const ctPath = join(BRV_DIR, CONTEXT_TREE_DIR, result.path)
              const { content: fullContent } = await this.fileSystem!.readFile(ctPath)
              content = fullContent
            } catch {
              // Use excerpt if full read fails
            }

            return { content, path: result.path, score: result.score, title: result.title }
          }),
      )

      if (!canRespondDirectly(fullResults)) return undefined

      return formatDirectResponse(query, fullResults)
    } catch {
      return undefined
    }
  }
}
