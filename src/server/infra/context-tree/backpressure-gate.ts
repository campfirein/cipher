// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateDecision = 'accept' | 'trigger-consolidation'

export interface BackpressureGateOptions {
  /** Max projected entries per file before triggering consolidation (default: 30). */
  maxEntriesPerFile?: number

  /** Minimum seconds between consolidations to prevent storms (default: 300 = 5 min). */
  minConsolidationIntervalSec?: number
}

export interface GateContext {
  /** ISO timestamp of last consolidation, or '' for never-consolidated. */
  lastConsolidatedAt: string

  /** Projected entry count: existing + incoming unique bullets. */
  projectedEntryCount: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ENTRIES_PER_FILE = 30
const DEFAULT_MIN_CONSOLIDATION_INTERVAL_SEC = 300

// ---------------------------------------------------------------------------
// BackpressureGate
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a background consolidation pass should be triggered
 * based on projected file size and time since last consolidation.
 *
 * Writes are never blocked or delayed — the gate only signals whether
 * the caller should schedule a background consolidation after writes complete.
 *
 * Decision logic:
 * 1. If `lastConsolidatedAt === ''`, treat as "never consolidated" (always eligible)
 * 2. If `projectedEntryCount >= maxEntriesPerFile` AND elapsed >= minConsolidationIntervalSec
 *    → `'trigger-consolidation'`
 * 3. Otherwise → `'accept'`
 */
export class BackpressureGate {
  private readonly maxEntriesPerFile: number
  private readonly minConsolidationIntervalSec: number

  constructor(options?: BackpressureGateOptions) {
    this.maxEntriesPerFile = options?.maxEntriesPerFile ?? DEFAULT_MAX_ENTRIES_PER_FILE
    this.minConsolidationIntervalSec = options?.minConsolidationIntervalSec ?? DEFAULT_MIN_CONSOLIDATION_INTERVAL_SEC
  }

  /**
   * Evaluate whether to trigger a background consolidation.
   */
  public evaluate(context: GateContext): GateDecision {
    if (context.projectedEntryCount < this.maxEntriesPerFile) {
      return 'accept'
    }

    // Check time since last consolidation
    const elapsedSec = this.getElapsedSeconds(context.lastConsolidatedAt)

    if (elapsedSec >= this.minConsolidationIntervalSec) {
      return 'trigger-consolidation'
    }

    return 'accept'
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get seconds elapsed since the given ISO timestamp.
   * Returns Infinity for empty string (never consolidated = always eligible).
   */
  private getElapsedSeconds(lastConsolidatedAt: string): number {
    if (!lastConsolidatedAt) {
      return Number.POSITIVE_INFINITY
    }

    const lastTime = new Date(lastConsolidatedAt).getTime()
    if (Number.isNaN(lastTime)) {
      return Number.POSITIVE_INFINITY
    }

    return (Date.now() - lastTime) / 1000
  }
}
