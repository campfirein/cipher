/**
 * IExperienceHookService — called by CurateExecutor after each successful curation.
 *
 * Implementations extract experience signals from the agent response, deduplicate
 * against existing bullets, write to the experience store, and trigger consolidation
 * when the curation threshold is reached.
 *
 * The hook is fail-open: errors must never surface to the curation caller.
 * Internal queue serialization prevents concurrent write races.
 */
export interface IExperienceHookService {
  /**
   * Process a completed curation response.
   * Implementations must be fail-open — any internal errors are swallowed.
   *
   * @param response - Full agent response from the curation task
   * @param insightsActive - Canonical paths of knowledge entries surfaced during this curation session
   */
  onCurateComplete(response: string, insightsActive?: string[]): Promise<void>
}
