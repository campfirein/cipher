/**
 * QueryDispatcher (Phase 5 Task 5.1) — deterministic tier 0/1/2 path.
 *
 * Owns the LLM-free portion of query handling so both `brv_query` (legacy
 * CLI / MCP) and `brv_search` (new MCP) can share the same code without
 * forking. Discriminated-union return; caller decides what to do with
 * each tier outcome.
 *
 * Stateless by design — `computeContextTreeFingerprint` stays on the
 * executor (per PHASE-5-VALIDATION.md §2.2 recommendation b). Caller
 * passes the resolved fingerprint in.
 *
 * Cache invariant: this module writes to cache ONLY on `direct_passages`.
 * The `formatNotFoundResponse` cache write (legacy executor behavior on
 * tier-2 empty BM25) is a human-facing response, not the dispatcher's
 * concern — kept in the executor.
 */

import {join} from 'node:path'

import type {IFileSystem} from '../../../agent/core/interfaces/i-file-system.js'
import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../agent/infra/sandbox/tools-sdk.js'
import type {QueryResultCache} from '../executor/query-result-cache.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {canRespondDirectly, type DirectSearchResult, formatDirectResponse} from '../executor/direct-search-responder.js'

/** Public passage shape returned to consumers (matches DESIGN §6.1 brv_search contract). */
export interface Passage {
  excerpt: string
  path: string
  score: number
}

export interface QueryDispatcherDeps {
  cache?: QueryResultCache
  fileSystem?: IFileSystem
  searchService?: ISearchKnowledgeService
}

export interface DispatchOptions {
  fingerprint?: string
  /**
   * Default 10 — matches DESIGN §6.1 + `BrvSearchInputSchema` (max 50).
   * Legacy `brv_query` path threads its own searchPromise with
   * `SMART_ROUTING_MAX_DOCS = 5` from `QueryExecutor`, so this default
   * only affects direct dispatcher consumers (`brv_search` MCP / CLI).
   */
  limit?: number
  query: string
  scope?: string
  /**
   * Caller-supplied in-flight search promise. When present, dispatcher
   * awaits it instead of firing its own search — preserves the legacy
   * executor's parallel-search-with-fingerprint optimization.
   */
  searchPromise?: Promise<SearchKnowledgeResult | undefined>
}

export type DispatchResult =
  | {
      cachedAnswer: string
      fingerprint?: string
      status: 'cached_answer'
      tier: 0 | 1
      timingMs: number
      totalFound: 0
    }
  | {
      directAnswer: string
      fingerprint?: string
      passages: Passage[]
      searchResult: SearchKnowledgeResult
      status: 'direct_passages'
      tier: 2
      timingMs: number
      totalFound: number
    }
  | {
      fingerprint?: string
      passages: []
      searchResult?: SearchKnowledgeResult
      status: 'no_results'
      tier: 2
      timingMs: number
      totalFound: number
    }
  | {
      fingerprint?: string
      passages: Passage[]
      searchResult: SearchKnowledgeResult
      status: 'needs_synthesis'
      tier: 2
      timingMs: number
      totalFound: number
    }

/* eslint-disable camelcase -- DESIGN §6.1 specifies snake_case for the brv_search public contract */

/**
 * Public `brv_search` MCP/CLI contract per DESIGN §6.1. This is the wire shape
 * external agents read — distinct from the internal `DispatchResult` discriminated
 * union which carries camelCase fields and the raw `searchResult` for tier 3/4
 * fall-through inside `QueryExecutor`.
 *
 * Per PHASE-5-CODE-REVIEW.md F4: the daemon must emit this DTO, NOT the internal
 * shape. Internal `searchResult` MUST NOT leak across the MCP boundary.
 */
export interface BrvSearchResult {
  cached_answer?: string
  fingerprint?: string
  passages?: Passage[]
  status: 'cached_answer' | 'direct_passages' | 'needs_synthesis' | 'no_results'
  tier: 0 | 1 | 2
  timing_ms: number
  total_found: number
}

/**
 * Map the internal `DispatchResult` to the public `BrvSearchResult` DTO.
 * Drops `searchResult` (internal), `directAnswer` (legacy formatter output —
 * not in DESIGN §6.1; agent reads `passages` for the direct case), and
 * renames camelCase fields to snake_case.
 */
export function toBrvSearchResult(r: DispatchResult): BrvSearchResult {
  const base = {
    ...(r.fingerprint === undefined ? {} : {fingerprint: r.fingerprint}),
    status: r.status,
    tier: r.tier,
    timing_ms: r.timingMs,
    total_found: r.totalFound,
  }

  if (r.status === 'cached_answer') {
    return {...base, cached_answer: r.cachedAnswer}
  }

  if (r.status === 'no_results') {
    return {...base, passages: []}
  }

  // 'direct_passages' or 'needs_synthesis' — both expose passages
  return {...base, passages: r.passages}
}

/* eslint-enable camelcase */

/**
 * BM25 result cap when caller doesn't pass `limit`. Matches DESIGN §6.1
 * (default 10, max 50) and the `BrvSearchInputSchema` JSDoc.
 *
 * The legacy `brv_query` path threads its own searchPromise (via
 * QueryExecutor with `SMART_ROUTING_MAX_DOCS = 5`) so this constant only
 * applies to direct dispatcher consumers — the `brv_search` MCP / CLI path.
 */
const DEFAULT_LIMIT = 10

/**
 * Max docs read fully (excerpt → full content) inside `tryDirectResponse`
 * for direct-answer formatting. Internal tuning knob — independent from
 * the public BM25 default. Mirrors the legacy executor's behavior.
 */
const DIRECT_RESPONSE_MAX_DOCS = 5

/** Mirrors SMART_ROUTING_SCORE_THRESHOLD in the legacy executor. */
const DIRECT_RESPONSE_SCORE_FLOOR = 0.7

export class QueryDispatcher {
  /**
   * Public so agent-process.ts can share the same cache instance with
   * `RecordAnswerExecutor` (Phase 5 Task 5.4) — closes the cache loop
   * for agent-synthesized answers without instantiating a parallel cache.
   */
  public readonly cache?: QueryResultCache
  private readonly fileSystem?: IFileSystem
  private readonly searchService?: ISearchKnowledgeService

  constructor(deps: QueryDispatcherDeps) {
    this.cache = deps.cache
    this.fileSystem = deps.fileSystem
    this.searchService = deps.searchService
  }

  async dispatch(options: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now()
    const {fingerprint, limit, query, scope, searchPromise} = options

    if (this.cache && fingerprint) {
      const exact = this.cache.get(query, fingerprint)
      if (exact) {
        return {
          cachedAnswer: exact,
          fingerprint,
          status: 'cached_answer',
          tier: 0,
          timingMs: Date.now() - startTime,
          totalFound: 0,
        }
      }

      const fuzzy = this.cache.findSimilar(query, fingerprint)
      if (fuzzy) {
        return {
          cachedAnswer: fuzzy,
          fingerprint,
          status: 'cached_answer',
          tier: 1,
          timingMs: Date.now() - startTime,
          totalFound: 0,
        }
      }
    }

    const searchResult = await this.resolveSearchResult({limit, query, scope, searchPromise})

    if (!searchResult || searchResult.results.length === 0) {
      return {
        fingerprint,
        passages: [],
        status: 'no_results',
        tier: 2,
        timingMs: Date.now() - startTime,
        totalFound: searchResult?.totalFound ?? 0,
        ...(searchResult ? {searchResult} : {}),
      }
    }

    const passages: Passage[] = searchResult.results.map((r) => ({
      excerpt: r.excerpt,
      path: r.path,
      score: r.score,
    }))

    if (this.fileSystem) {
      const directAnswer = await this.tryDirectResponse(query, searchResult)
      if (directAnswer) {
        if (this.cache && fingerprint) {
          this.cache.set(query, directAnswer, fingerprint)
        }

        return {
          directAnswer,
          fingerprint,
          passages,
          searchResult,
          status: 'direct_passages',
          tier: 2,
          timingMs: Date.now() - startTime,
          totalFound: searchResult.totalFound,
        }
      }
    }

    return {
      fingerprint,
      passages,
      searchResult,
      status: 'needs_synthesis',
      tier: 2,
      timingMs: Date.now() - startTime,
      totalFound: searchResult.totalFound,
    }
  }

  private async resolveSearchResult(opts: {
    limit?: number
    query: string
    scope?: string
    searchPromise?: Promise<SearchKnowledgeResult | undefined>
  }): Promise<SearchKnowledgeResult | undefined> {
    if (opts.searchPromise) {
      try {
        return await opts.searchPromise
      } catch {
        return undefined
      }
    }

    if (!this.searchService) return undefined

    try {
      return await this.searchService.search(opts.query, {
        limit: opts.limit ?? DEFAULT_LIMIT,
        ...(opts.scope ? {scope: opts.scope} : {}),
      })
    } catch {
      return undefined
    }
  }

  private async tryDirectResponse(
    query: string,
    searchResult: SearchKnowledgeResult,
  ): Promise<string | undefined> {
    if (!this.fileSystem) return undefined
    const {fileSystem} = this

    try {
      if (searchResult.totalFound === 0) return undefined

      const fullResults: DirectSearchResult[] = await Promise.all(
        searchResult.results
          .filter((r) => r.score >= DIRECT_RESPONSE_SCORE_FLOOR)
          .slice(0, DIRECT_RESPONSE_MAX_DOCS)
          .map(async (result) => {
            let content = result.excerpt
            try {
              const ctBase = result.originContextTreeRoot ?? join(BRV_DIR, CONTEXT_TREE_DIR)
              const ctPath = join(ctBase, result.path)
              const {content: fullContent} = await fileSystem.readFile(ctPath)
              content = fullContent
            } catch {
              // fall back to excerpt
            }

            const displayPath =
              result.origin === 'shared' && result.originAlias
                ? `[${result.originAlias}]:${result.path}`
                : result.path

            return {content, path: displayPath, score: result.score, title: result.title}
          }),
      )

      if (!canRespondDirectly(fullResults)) return undefined
      return formatDirectResponse(query, fullResults)
    } catch {
      return undefined
    }
  }
}
