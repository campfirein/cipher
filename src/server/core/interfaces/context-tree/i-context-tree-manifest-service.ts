import type {ContextManifest, LaneTokens, ResolvedEntry} from '../../domain/knowledge/summary-types.js'

/**
 * Service for building and reading the context manifest (_manifest.json).
 *
 * The manifest allocates context tree entries into three lanes
 * (summaries, contexts, stubs) with token budgets, enabling
 * efficient context injection for queries.
 */
export interface IContextTreeManifestService {
  /**
   * Build (or rebuild) the manifest from current context tree state.
   * Writes _manifest.json and returns the manifest.
   */
  buildManifest(directory?: string, laneBudgets?: LaneTokens): Promise<ContextManifest>

  /**
   * Read the manifest from disk. Returns null if no manifest exists.
   */
  readManifest(directory?: string): Promise<ContextManifest | null>

  /**
   * Read the manifest only if it is fresh (source-fingerprint match).
   * Returns null if the manifest is stale or missing.
   */
  readManifestIfFresh(directory?: string): Promise<ContextManifest | null>

  /**
   * Resolve manifest entries into content ready for prompt injection.
   * Orders: summaries (broadest first) → contexts → stubs.
   * If query is provided, reorders contexts by BM25 relevance.
   */
  resolveForInjection(manifest: ContextManifest, query?: string, directory?: string): Promise<ResolvedEntry[]>
}
