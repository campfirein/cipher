/**
 * AutoHarness V2 — Outcome recorder.
 *
 * Fire-and-forget: `SandboxService` calls `recorder.record(...)` without
 * `await`ing. The recorder is responsible for backpressure (semaphore
 * with 5 permits), per-session rate limiting (50 outcomes), session
 * state tracking, and event emission.
 *
 * `attachFeedback` implements the 3x/1x weighting policy from §C2:
 * set the `userFeedback` field on the original, then insert synthetic
 * clones so the heuristic weights user opinion proportionally.
 *
 * Implements contracts §C1, §C2, §C3, §C5, §C6, §C7 from
 * `features/autoharness-v2/tasks/phase_1_2_handoff.md`.
 */

import {randomUUID} from 'node:crypto'

import type {CodeExecOutcome, ProjectType} from '../../core/domain/harness/types.js'
import type {REPLResult} from '../../core/domain/sandbox/types.js'
import type {IHarnessStore} from '../../core/interfaces/i-harness-store.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../agent/agent-schemas.js'
import type {SessionEventBus} from '../events/event-emitter.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecordParams {
  code: string
  commandType: 'chat' | 'curate' | 'query'
  /** Reserved for Task 2.4 — threaded from AgentLLMService conversation loop. */
  conversationTurn?: number
  executionTimeMs: number
  harnessVersionId?: string
  projectId: string
  projectType: ProjectType
  result: REPLResult
  sessionId: string
  /** Reserved for Task 2.4 — threaded from AgentLLMService conversation loop. */
  taskDescription?: string
}

// ---------------------------------------------------------------------------
// Usage-detection regexes (§C1)
// ---------------------------------------------------------------------------

// Capabilities from HarnessCapabilitySchema (core/domain/harness/types.ts) + meta pseudo-method
// + query (commandType-level harness method, not yet formalized in the capability enum).
// If a new capability is added to the schema, update this regex to match.
const HARNESS_CALL_RE =
  /\bharness\.(curate|query|search|extract|gather|answer|buildOps|discover|meta)\b/

// ---------------------------------------------------------------------------
// Semaphore — bounded concurrency for store writes
// ---------------------------------------------------------------------------

class Semaphore {
  private permits: number
  private readonly waiting: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve)
    })
  }

  release(): void {
    const next = this.waiting.shift()
    if (next) {
      next()
    } else {
      this.permits++
    }
  }
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/** Synthetic outcome count per verdict (§C2 weighting policy). */
const BAD_SYNTHETIC_COUNT = 3
const FEEDBACK_LIST_LIMIT = 100
const GOOD_SYNTHETIC_COUNT = 1
const MAX_OUTCOMES_PER_SESSION = 50
const SEMAPHORE_PERMITS = 5

export class HarnessOutcomeRecorder {
  private readonly commandTypesBySession = new Map<string, Set<string>>()
  private readonly config: ValidatedHarnessConfig
  private readonly logger: ILogger
  private readonly semaphore = new Semaphore(SEMAPHORE_PERMITS)
  private readonly sessionCount = new Map<string, number>()
  private readonly sessionEventBus: SessionEventBus
  private readonly store: IHarnessStore

  constructor(
    store: IHarnessStore,
    sessionEventBus: SessionEventBus,
    logger: ILogger,
    config: ValidatedHarnessConfig,
  ) {
    this.store = store
    this.sessionEventBus = sessionEventBus
    this.logger = logger
    this.config = config
  }

  /**
   * Attach user feedback to an outcome and insert synthetic clones
   * per the 3x/1x weighting policy (§C2).
   *
   * - `'bad'`  → `recordFeedback` + 3 synthetic `saveOutcome` calls
   * - `'good'` → `recordFeedback` + 1 synthetic `saveOutcome` call
   * - `null`   → `recordFeedback` only (clears the flag, no synthetics)
   *
   * `OUTCOME_NOT_FOUND` from `store.recordFeedback` propagates to the
   * caller. Synthetic-insertion failures are logged and swallowed —
   * partial insertion is tolerable.
   *
   * Does NOT use the recorder's semaphore or rate limit — this is
   * user-driven, not on the code-exec hot path.
   */
  async attachFeedback(
    projectId: string,
    commandType: string,
    outcomeId: string,
    verdict: 'bad' | 'good' | null,
  ): Promise<void> {
    // 1. Set the field on the original — propagates OUTCOME_NOT_FOUND
    await this.store.recordFeedback(projectId, commandType, outcomeId, verdict)

    // 2. No synthetics for null verdict (just clearing the flag)
    if (verdict === null) return

    // 3. Find the original in recent outcomes for cloning
    const recentOutcomes = await this.store.listOutcomes(projectId, commandType, FEEDBACK_LIST_LIMIT)
    const original = recentOutcomes.find((o) => o.id === outcomeId)

    if (!original) {
      this.logger.warn('Outcome not found in recent listings — skipping synthetic insertion', {
        commandType,
        limit: FEEDBACK_LIST_LIMIT,
        outcomeId,
        projectId,
      })
      return
    }

    // 4. Insert synthetic clones
    const count = verdict === 'bad' ? BAD_SYNTHETIC_COUNT : GOOD_SYNTHETIC_COUNT

    const syntheticPromises = Array.from({length: count}, (_, i) => {
      const synthetic: CodeExecOutcome = {
        ...original,
        id: randomUUID(),
        userFeedback: verdict,
      }
      return this.store.saveOutcome(synthetic).catch((error: unknown) => {
        this.logger.warn('Synthetic outcome insertion failed', {
          commandType,
          error,
          outcomeId,
          projectId,
          syntheticIndex: i,
        })
      })
    })

    await Promise.allSettled(syntheticPromises)
  }

  /**
   * Release all per-session state. Called on agent shutdown.
   */
  cleanup(): void {
    this.commandTypesBySession.clear()
    this.sessionCount.clear()
  }

  /**
   * Release per-session state for a single session. Called when a session
   * ends so the Maps don't grow unbounded in long-running agents.
   */
  clearSession(sessionId: string): void {
    this.commandTypesBySession.delete(sessionId)
    this.sessionCount.delete(sessionId)
  }

  /**
   * Returns the set of command types seen for a session. Phase 6 uses
   * this to trigger refinement only for command types the session touched.
   */
  getCommandTypesForSession(sessionId: string): ReadonlySet<string> {
    return this.commandTypesBySession.get(sessionId) ?? new Set<string>()
  }

  /**
   * Record a code_exec outcome. Fire-and-forget from the caller's
   * perspective — errors are logged, never propagated.
   */
  async record(params: RecordParams): Promise<void> {
    // 1. Early return if disabled
    if (!this.config.enabled) return

    // 2. Usage detection
    let usedHarness = HARNESS_CALL_RE.test(params.code)
    if (usedHarness && !params.harnessVersionId) {
      this.logger.warn('usedHarness detected but harnessVersionId missing — downgrading', {
        commandType: params.commandType,
        projectId: params.projectId,
        sessionId: params.sessionId,
      })
      usedHarness = false
    }

    // 3. Build outcome
    const outcome: CodeExecOutcome = {
      code: params.code,
      commandType: params.commandType,
      curateResult: params.result.curateResults,
      delegated: undefined, // placeholder — real detection lives in §C1
      executionTimeMs: params.executionTimeMs,
      harnessVersionId: usedHarness ? params.harnessVersionId : undefined,
      id: randomUUID(),
      projectId: params.projectId,
      projectType: params.projectType,
      sessionId: params.sessionId,
      stderr: params.result.stderr.length > 0 ? params.result.stderr : undefined,
      stdout: params.result.stdout.length > 0 ? params.result.stdout : undefined,
      // Approximation: any stderr = failure. Task 2.3 replaces with an
      // explicit boolean from the sandbox runner to avoid false positives
      // from deprecation warnings, console.warn, etc.
      success: params.result.stderr.length === 0,
      timestamp: Date.now(),
      usedHarness,
    }

    // 4. Session state update — BEFORE rate limit check
    if (this.commandTypesBySession.has(params.sessionId)) {
      this.commandTypesBySession.get(params.sessionId)?.add(params.commandType)
    } else {
      this.commandTypesBySession.set(params.sessionId, new Set<string>([params.commandType]))
    }

    // 5. Rate limit check — counter increments BEFORE write intentionally.
    // Moving it after the write opens a concurrency window: N parallel calls
    // all read count < 50, all pass, all write — defeating the cap.
    // Tradeoff: transient store failures burn slots. Acceptable for v1.0;
    // the 50-slot budget is generous for human-paced sessions.
    const count = this.sessionCount.get(params.sessionId) ?? 0
    this.sessionCount.set(params.sessionId, count + 1)
    if (count >= MAX_OUTCOMES_PER_SESSION) {
      this.logger.debug('Rate limit reached for session', {sessionId: params.sessionId})
      return
    }

    // 6. Bounded concurrency — acquire semaphore permit
    await this.semaphore.acquire()
    try {
      await this.store.saveOutcome(outcome)

      // 7. Event emission — only after successful write
      this.sessionEventBus.emit('harness:outcome-recorded', {
        commandType: outcome.commandType,
        outcomeId: outcome.id,
        projectId: outcome.projectId,
        success: outcome.success,
      })
    } catch (error) {
      // 8. Error handling — log and swallow
      this.logger.warn('saveOutcome failed', {
        commandType: outcome.commandType,
        error,
        outcomeId: outcome.id,
        projectId: outcome.projectId,
      })
    } finally {
      this.semaphore.release()
    }
  }
}
