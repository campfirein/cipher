/**
 * IRecordAnswerExecutor (Phase 5 Task 5.4) — closes the cache loop for
 * agent-synthesized answers. The agent calls this AFTER synthesizing from
 * a `brv_gather` bundle, so future equivalent queries can hit tier 0/1
 * via `brv_search` / `brv_query`.
 *
 * Without this hook, agent-synthesized answers are discarded and the
 * cache only sees tier-2 direct BM25 hits.
 */

export interface RecordAnswerOptions {
  answer: string
  /**
   * Required cache key match — the fingerprint the agent received from
   * its prior `brv_search` or `brv_gather` call. Without it the cache
   * write would be invisible to future fingerprint-aware reads.
   */
  fingerprint: string
  query: string
}

export interface RecordAnswerResult {
  fingerprint: string
  /** false when no cache is configured on the daemon (graceful no-op). */
  recorded: boolean
}

export interface IRecordAnswerExecutor {
  execute(options: RecordAnswerOptions): Promise<RecordAnswerResult>
}
