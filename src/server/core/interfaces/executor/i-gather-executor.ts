/**
 * IGatherExecutor (Phase 5 Task 5.3) — assembles a context bundle for an
 * external agent (or human user) to synthesize from. NEVER invokes the LLM.
 *
 * Backs both the `brv_gather` MCP tool and the `brv gather` CLI command.
 * Output shape mirrors DESIGN §6.2 — snake_case fields are intentional and
 * match the MCP wire format the agent reads. Interface property names don't
 * trigger ESLint's camelcase rule; consumer files that USE these fields need
 * the per-file disable directive.
 */

export interface GatherExecuteOptions {
  /** Result cap, default 10, max 50. */
  limit?: number
  query: string
  /** Optional path-prefix scope filter. */
  scope?: string
  /** Soft cap on total tokens in the bundle (default 4000 per DESIGN §6.2). */
  tokenBudget?: number
}

export interface GatherSearchMetadata {
  result_count: number
  top_score: number
  total_found: number
}

export interface GatherResult {
  /** Optional rule-based hints when results are sparse or low-confidence. */
  follow_up_hints?: string[]
  /**
   * Manifest-derived structural snippets (broad context).
   *
   * **Reserved field — DEFERRED to a follow-up phase** (PHASE-5-CODE-REVIEW.md F8).
   * The current `GatherExecutor` does not populate this field; agents should
   * treat its presence as optional and synthesize from `prefetched_context`
   * alone for now. Wiring `FileContextTreeManifestService.resolveForInjection`
   * into GatherExecutor requires a baseDirectory dep + IFileSystem dep and
   * adds I/O latency — deferred until a real consumer demonstrates the need.
   */
  manifest_context?: string
  /** Markdown-formatted bundle of high-confidence excerpts. Empty string if none. */
  prefetched_context: string
  search_metadata: GatherSearchMetadata
  total_tokens_estimated: number
}

export interface IGatherExecutor {
  execute(options: GatherExecuteOptions): Promise<GatherResult>
}
