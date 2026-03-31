/**
 * Session-scoped tracker for knowledge entries surfaced during curation.
 *
 * Records which context-tree entries were returned by tools.searchKnowledge()
 * during a specific task session, so that performance signals can be correlated
 * with the entries that informed the curation.
 *
 * Session isolation prevents cross-task bleed when multiple curations overlap.
 */
export class SessionInsightsTracker {
  private readonly pathsBySession = new Map<string, Set<string>>()

  /**
   * Clear all paths for a session without returning them.
   * Called in the curate executor's finally block to prevent leaks on failure.
   */
  clearSession(sessionId: string): void {
    this.pathsBySession.delete(sessionId)
  }

  /**
   * Drain and return all surfaced paths for a session, then clear.
   * Called by the curate executor after successful curation.
   */
  drainSession(sessionId: string): string[] {
    const set = this.pathsBySession.get(sessionId)
    this.pathsBySession.delete(sessionId)

    return set ? [...set] : []
  }

  /**
   * Record paths of entries surfaced during a search in this session.
   */
  recordSurfacedPaths(sessionId: string, paths: string[]): void {
    let set = this.pathsBySession.get(sessionId)
    if (!set) {
      set = new Set()
      this.pathsBySession.set(sessionId, set)
    }

    for (const p of paths) {
      set.add(p)
    }
  }
}
