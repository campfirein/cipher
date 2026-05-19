/**
 * SearchExecutor - Executes context tree searches via SearchKnowledgeService.
 *
 * Unlike QueryExecutor (Tier 0-4 with LLM synthesis), SearchExecutor is
 * pure retrieval: BM25 index lookup → scored results. No LLM, no agent
 * session, no sandbox, no token cost.
 *
 * This is the engine behind `brv search`. The CLI command and transport
 * layer handle I/O; this module handles the search logic.
 */

import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../agent/infra/sandbox/tools-sdk.js'
import type {ISearchExecutor, SearchExecuteOptions} from '../../core/interfaces/executor/i-search-executor.js'
import type {IRuntimeSignalStore} from '../../core/interfaces/storage/i-runtime-signal-store.js'

import {bumpSidecarOnQueryRead} from '../context-tree/tool-mode-sidecar-updaters.js'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export class SearchExecutor implements ISearchExecutor {
  private readonly runtimeSignalStore: IRuntimeSignalStore | undefined
  private readonly searchService: ISearchKnowledgeService

  constructor(searchService: ISearchKnowledgeService, runtimeSignalStore?: IRuntimeSignalStore) {
    this.searchService = searchService
    this.runtimeSignalStore = runtimeSignalStore
  }

  async execute(options: SearchExecuteOptions): Promise<SearchKnowledgeResult> {
    const query = options.query.trim()
    if (!query) {
      return {message: 'Empty query', results: [], totalFound: 0}
    }

    const scope = options.scope?.trim() || undefined
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)),
    )

    const result = await this.searchService.search(query, {
      limit,
      ...(scope ? {scope} : {}),
    })

    // Bump runtime-signal accessCount per matched path so prune (and any
    // future signal-driven ranking) has real read-side data. Best-effort:
    // sidecar failure must never break search. Skip shared-source results —
    // their `path` is relative to the SHARED origin context tree, not the
    // local sidecar's project, so writing them here would either orphan an
    // entry or collide with a same-named local topic and corrupt ranking.
    // Mirrors `QueryExecutor.buildToolModeMatches` which already filters
    // shared origins out of the tool-mode envelope.
    if (this.runtimeSignalStore && result.results.length > 0) {
      const localPaths = result.results
        .filter((r) => !r.origin || r.origin === 'local')
        .map((r) => r.path)
      if (localPaths.length > 0) {
        await bumpSidecarOnQueryRead({
          relPaths: localPaths,
          store: this.runtimeSignalStore,
        })
      }
    }

    return result
  }
}
