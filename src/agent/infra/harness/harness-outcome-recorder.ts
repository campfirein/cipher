/**
 * AutoHarness V2 — Outcome recorder.
 *
 * Fire-and-forget: `SandboxService` calls `recorder.record(...)` without
 * `await`ing. The recorder is responsible for backpressure (semaphore
 * with 5 permits), per-session rate limiting (50 outcomes), session
 * state tracking, and event emission.
 *
 * Implements contracts §C1, §C3, §C5, §C6, §C7 from
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

// Capabilities from HarnessCapabilitySchema (core/domain/harness/types.ts) + meta pseudo-method.
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
      stderr: params.result.stderr || undefined,
      stdout: params.result.stdout || undefined,
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

    // 5. Rate limit check — counter increments BEFORE write
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
