/**
 * AutoHarness V2 — Scenario capture from real sessions.
 *
 * Captures `EvaluationScenario` records from both successful AND failed
 * sessions so the Evaluator has real test cases to score candidate
 * harness versions against. Negative scenarios prevent the Refiner
 * from "improving" into a harness that succeeds by damaging data.
 *
 * Called in-line after outcome recording — not out-of-band — so a
 * scenario can't be captured for an outcome that didn't persist.
 * The call site (outcome recorder or session-end hook) is wired
 * separately.
 *
 * Concurrent-capture safety is achieved via per-pair promise chaining:
 * the list→dedup→evict→save sequence serializes for each
 * `(projectId, commandType)` pair, so the 20-scenario cap holds even
 * under parallel captures.
 */

import {randomUUID} from 'node:crypto'

import type {CodeExecOutcome, ProjectType} from '../../core/domain/harness/types.js'
import type {IHarnessStore} from '../../core/interfaces/i-harness-store.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum scenarios per `(projectId, commandType)` pair. */
const MAX_SCENARIOS_PER_PAIR = 20

/**
 * Structural failure pattern for negative capture selection.
 * Matches common JavaScript/Python error class names in stderr.
 */
const STRUCTURAL_FAILURE_PATTERN = /Error|Exception|Failed|Rejected/

/** Minimum query confidence score for positive query capture. */
const MIN_QUERY_TOP_SCORE = 0.7

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CaptureContext {
  readonly code: string
  /** Matches EvaluationScenarioSchema.commandType (core/domain/harness/types.ts). */
  readonly commandType: 'chat' | 'curate' | 'query'
  readonly outcome: CodeExecOutcome
  readonly projectId: string
  readonly projectType: ProjectType
  readonly taskDescription: string
}

// ---------------------------------------------------------------------------
// Type guards for unknown outcome fields
// ---------------------------------------------------------------------------

/**
 * Checks whether `curateResult` contains at least one applied operation.
 * `CodeExecOutcome.curateResult` is `z.unknown()` — populated from
 * `REPLResult.curateResults` (an array of curate call results).
 */
function hasAppliedCurateOps(curateResult: unknown): boolean {
  return Array.isArray(curateResult) && curateResult.length > 0
}

/**
 * Extracts the `topScore` from an unknown `queryResult`, returning
 * `undefined` when the shape doesn't match. Avoids `as Type` casts
 * by using `in` narrowing (TS 4.9+).
 */
function getQueryTopScore(queryResult: unknown): number | undefined {
  if (typeof queryResult !== 'object' || queryResult === null) return undefined
  if (!('topScore' in queryResult)) return undefined
  return typeof queryResult.topScore === 'number' ? queryResult.topScore : undefined
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type CaptureType = 'negative' | 'positive'

export class HarnessScenarioCapture {
  /** Tracks `${sessionId}\0${commandType}` keys for rate-limiting negative captures. */
  private readonly negativeCaptured = new Set<string>()
  /**
   * Per-pair promise chain for serializing concurrent captures.
   * Each `(projectId, commandType)` pair chains its list→dedup→evict→save
   * sequence so the 20-scenario cap holds under parallel calls.
   */
  private readonly pairLocks = new Map<string, Promise<void>>()

  constructor(
    private readonly harnessStore: IHarnessStore,
    private readonly logger: ILogger,
  ) {}

  /**
   * Capture policy — called once per interesting outcome.
   *
   * Determines whether the outcome is worth capturing as a scenario,
   * deduplicates against existing scenarios, enforces the per-pair cap
   * via LRU eviction, and rate-limits negative captures to one per
   * session per commandType.
   */
  async captureIfInteresting(ctx: CaptureContext): Promise<void> {
    if (ctx.commandType === 'chat') return

    const captureType = this.classifyCapture(ctx)
    if (captureType === undefined) return

    // Negative rate-limit pre-check: fast path avoids entering the lock when
    // a negative for this session+commandType was already captured. The
    // authoritative check is inside the lock (below) to close the race where
    // two concurrent negatives both pass this line before either adds to the
    // Set. This outer check is a performance optimization only.
    if (captureType === 'negative') {
      const rateKey = `${ctx.outcome.sessionId}\0${ctx.commandType}`
      if (this.negativeCaptured.has(rateKey)) return
    }

    await this.withPairLock(ctx.projectId, ctx.commandType, async () => {
      // Authoritative negative rate-limit check inside the lock. Concurrent
      // calls serialize here, so the Set reflects all prior captures.
      if (captureType === 'negative') {
        const rateKey = `${ctx.outcome.sessionId}\0${ctx.commandType}`
        if (this.negativeCaptured.has(rateKey)) return
      }

      const existing = await this.harnessStore.listScenarios(ctx.projectId, ctx.commandType)

      // Dedup: skip if an identical (taskDescription, code) scenario exists
      const isDuplicate = existing.some(
        (s) => s.taskDescription === ctx.taskDescription && s.code === ctx.code,
      )
      if (isDuplicate) {
        this.logger.debug('HarnessScenarioCapture: skipping duplicate scenario', {
          commandType: ctx.commandType,
          projectId: ctx.projectId,
        })
        return
      }

      // LRU eviction: delete the oldest by createdAt when at cap.
      // Sort explicitly — listScenarios ordering is store-dependent
      // (InMemoryHarnessStore preserves insertion order; FileKeyStorage
      // orders lexicographically by key, which may not match createdAt).
      if (existing.length >= MAX_SCENARIOS_PER_PAIR) {
        const sorted = [...existing].sort((a, b) => a.createdAt - b.createdAt)
        const oldest = sorted[0]
        await this.harnessStore.deleteScenario(ctx.projectId, ctx.commandType, oldest.id)
        this.logger.debug('HarnessScenarioCapture: evicted oldest scenario for LRU cap', {
          commandType: ctx.commandType,
          evictedId: oldest.id,
          projectId: ctx.projectId,
        })
      }

      await this.harnessStore.saveScenario({
        code: ctx.code,
        commandType: ctx.commandType,
        createdAt: Date.now(),
        expectedBehavior: this.deriveExpectedBehavior(captureType, ctx),
        id: randomUUID(),
        projectId: ctx.projectId,
        projectType: ctx.projectType,
        taskDescription: ctx.taskDescription,
      })

      // Mark negative capture for session rate-limiting (after successful save)
      if (captureType === 'negative') {
        this.negativeCaptured.add(`${ctx.outcome.sessionId}\0${ctx.commandType}`)
      }

      this.logger.debug('HarnessScenarioCapture: captured scenario', {
        captureType,
        commandType: ctx.commandType,
        projectId: ctx.projectId,
      })
    })
  }

  /** Clear all per-session state. */
  cleanup(): void {
    this.negativeCaptured.clear()
    this.pairLocks.clear()
  }

  /** Remove negative-capture tracking for a session. */
  clearSession(sessionId: string): void {
    for (const key of this.negativeCaptured) {
      if (key.startsWith(`${sessionId}\0`)) {
        this.negativeCaptured.delete(key)
      }
    }
  }

  // ── private ─────────────────────────────────────────────────────────────────

  /**
   * Classify whether an outcome is interesting enough to capture.
   *
   * Returns 'positive', 'negative', or `undefined` (skip).
   *
   * Selection rules from the spec:
   *   - Positive curate: success AND curateResult has applied ops
   *   - Positive query: success AND queryResult.topScore >= 0.7
   *   - Negative: !success AND stderr matches structural failure pattern
   *   - Chat: never captured (filtered upstream in captureIfInteresting)
   */
  private classifyCapture(ctx: CaptureContext): CaptureType | undefined {
    const {outcome} = ctx

    // Negative capture: structural failure in stderr
    if (!outcome.success) {
      if (outcome.stderr && STRUCTURAL_FAILURE_PATTERN.test(outcome.stderr)) {
        return 'negative'
      }

      return undefined
    }

    // Positive capture by commandType
    switch (ctx.commandType) {
      case 'curate': {
        return hasAppliedCurateOps(outcome.curateResult) ? 'positive' : undefined
      }

      case 'query': {
        const topScore = getQueryTopScore(outcome.queryResult)
        return topScore !== undefined && topScore >= MIN_QUERY_TOP_SCORE ? 'positive' : undefined
      }

      default: {
        return undefined
      }
    }
  }

  /**
   * Derive `expectedBehavior` wording based on capture type.
   *
   * For v1.0, `expectedBehavior` is a short string logged by the evaluator,
   * not used for pass/fail assertion. When LLM-as-judge scoring lands
   * (v1.x), the wording becomes load-bearing.
   *
   * Negative wording heuristic: 'Rejects malformed input' when stderr
   * suggests rejection; 'Returns error without corrupting state' otherwise.
   */
  private deriveExpectedBehavior(captureType: CaptureType, ctx: CaptureContext): string {
    if (captureType === 'positive') {
      return 'Succeeds without errors'
    }

    // Negative: distinguish rejection from generic error
    if (ctx.outcome.stderr && /Rejected/.test(ctx.outcome.stderr)) {
      return 'Rejects malformed input'
    }

    return 'Returns error without corrupting state'
  }

  /**
   * Serialize operations per `(projectId, commandType)` pair.
   *
   * Chains promises so that concurrent `captureIfInteresting` calls
   * for the same pair execute their list→dedup→evict→save sequence
   * one at a time. Different pairs run in parallel.
   */
  private withPairLock(
    projectId: string,
    commandType: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const key = `${projectId}\0${commandType}`
    const previous = this.pairLocks.get(key) ?? Promise.resolve()
    // Chain: swallow previous errors so one failed capture doesn't block
    // subsequent captures for the same pair, then run fn.
    const current = previous.catch(() => {}).then(fn)
    // Store a never-rejecting version for chaining; clean up the entry
    // once settled so pairLocks doesn't grow unbounded across projects.
    const stored = current.then(() => {}, () => {})
    this.pairLocks.set(key, stored)
    stored.finally(() => {
      if (this.pairLocks.get(key) === stored) {
        this.pairLocks.delete(key)
      }
    })
    return current
  }
}
