/**
 * AutoHarness V2 — HarnessSynthesizer.
 *
 * Orchestrates the Critic → Refiner → Evaluator pipeline into one
 * `refineIfNeeded(projectId, commandType)` entry point. Called from
 * the session-end trigger or manually.
 *
 * Responsibilities:
 *   - Per-pair single-flight gate (log-and-drop on contention)
 *   - Weak-model refinement skip (Tier 1 X2)
 *   - Critic LLM call → analysis string
 *   - Refiner LLM call → candidate code (with markdown-fence fallback)
 *   - Evaluation via HarnessEvaluator
 *   - Accept: save new version, emit event
 *   - Reject: log reason, emit event
 *   - VERSION_CONFLICT on concurrent cross-instance race: treat as
 *     "accepted by someone else"
 */

import {randomUUID} from 'node:crypto'

import type {HarnessVersion} from '../../core/domain/harness/types.js'
import type {IHarnessStore} from '../../core/interfaces/i-harness-store.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../agent/agent-schemas.js'
import type {AgentEventBus} from '../events/event-emitter.js'
import type {HarnessEvaluator} from './harness-evaluator.js'
import type {IRefinerClient} from './harness-refiner-client.js'
import type {HarnessScenarioCapture} from './harness-scenario-capture.js'

import {
  HarnessStoreError,
  HarnessStoreErrorCode,
} from '../../core/domain/errors/harness-store-error.js'
import {computeHeuristic} from '../../core/domain/harness/heuristic.js'
import {HarnessModuleBuilder} from './harness-module-builder.js'
import {isBlocklistedForRefinement} from './model-policy.js'
import {buildCriticPrompt} from './prompts/critic-prompt.js'
import {buildRefinerPrompt} from './prompts/refiner-prompt.js'
import {TOOLS_SDK_DOCUMENTATION} from './prompts/sdk-documentation.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Outcomes window for baseline heuristic + critic context. */
const OUTCOMES_WINDOW = 50

/**
 * Skip refinement when baseline H is at or above this threshold
 * AND all scenarios are passing — the harness is already performing
 * well enough that LLM calls would be wasted.
 */
const SKIP_REFINEMENT_THRESHOLD = 0.85

/**
 * Strip a single leading/trailing markdown fence pair from LLM output.
 * Weak models add fences despite prompt instructions; one fallback
 * layer is sufficient — further stripping invites complexity.
 * Trailing `\s*` tolerates models that append a trailing newline.
 */
const MARKDOWN_FENCE_RE = /^```(?:\w*)\n([\s\S]*?)\n```\s*$/

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SynthesisResult {
  readonly accepted: boolean
  readonly deltaH?: number
  readonly fromVersionId: string
  readonly reason?: string
  readonly toVersionId?: string
}

// ---------------------------------------------------------------------------
// HarnessSynthesizer
// ---------------------------------------------------------------------------

export class HarnessSynthesizer {
  private readonly inFlight = new Map<string, Promise<SynthesisResult | undefined>>()
  private readonly moduleBuilder: HarnessModuleBuilder
  private readonly weakModelWarned = new Set<string>()

  constructor(
    private readonly harnessStore: IHarnessStore,
    private readonly evaluator: HarnessEvaluator,
    // Held for session-end trigger wiring — the trigger needs
    // scenarioCapture available alongside the synthesizer. Scenario
    // listing goes through harnessStore.listScenarios() directly
    // because HarnessScenarioCapture has no list method.
    private readonly _scenarioCapture: HarnessScenarioCapture,
    private readonly refinerClient: IRefinerClient,
    private readonly eventBus: AgentEventBus,
    private readonly config: ValidatedHarnessConfig,
    private readonly logger: ILogger,
  ) {
    this.moduleBuilder = new HarnessModuleBuilder(logger)
  }

  /**
   * Clear per-session state. Called by the session-end trigger
   * between sessions so weak-model warnings fire once per session,
   * not once per synthesizer lifetime.
   */
  cleanup(): void {
    this.weakModelWarned.clear()
  }

  /**
   * Run the Critic → Refiner → Evaluator pipeline for a single
   * `(projectId, commandType)` pair. Returns `undefined` when
   * refinement was skipped (no parent, weak model, in-flight
   * contention, or nothing to refine).
   */
  async refineIfNeeded(
    projectId: string,
    commandType: 'chat' | 'curate' | 'query',
  ): Promise<SynthesisResult | undefined> {
    // 1. Weak-model skip (before single-flight gate — cheap check)
    if (this.config.refinementModel === undefined && isBlocklistedForRefinement(this.refinerClient.modelId)) {
      const warnKey = `${projectId}\0${commandType}`
      if (!this.weakModelWarned.has(warnKey)) {
        this.weakModelWarned.add(warnKey)
        this.logger.warn('HarnessSynthesizer: skipping refinement — runtime model is blocklisted', {
          commandType,
          modelId: this.refinerClient.modelId,
          projectId,
        })
      }

      return undefined
    }

    // 2. Per-pair single-flight gate
    const pairKey = `${projectId}\0${commandType}`
    const existing = this.inFlight.get(pairKey)
    if (existing !== undefined) {
      this.logger.info('HarnessSynthesizer: refinement already in flight, dropping', {
        commandType,
        projectId,
      })
      return undefined
    }

    const promise = this.doRefine(projectId, commandType)
    this.inFlight.set(pairKey, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(pairKey)
    }
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private async acceptCandidate(opts: {
    candidateCode: string
    candidateHeuristic: number
    deltaH: number
    parent: HarnessVersion
  }): Promise<SynthesisResult> {
    const {candidateCode, candidateHeuristic, deltaH, parent} = opts

    // Build candidate to extract metadata safely — compute metadata
    // before constructing the final version so the object is fully
    // formed in one place without post-construction mutation.
    const protoVersion: HarnessVersion = {
      code: candidateCode,
      commandType: parent.commandType,
      createdAt: Date.now(),
      heuristic: candidateHeuristic,
      id: randomUUID(),
      metadata: parent.metadata,
      parentId: parent.id,
      projectId: parent.projectId,
      projectType: parent.projectType,
      version: parent.version + 1,
    }
    const buildResult = this.moduleBuilder.build(protoVersion)
    const candidateVersion: HarnessVersion = {
      ...protoVersion,
      metadata: buildResult.loaded ? buildResult.module.meta() : parent.metadata,
    }

    try {
      await this.harnessStore.saveVersion(candidateVersion)
    } catch (error) {
      if (HarnessStoreError.isCode(error, HarnessStoreErrorCode.VERSION_CONFLICT)) {
        this.logger.debug('HarnessSynthesizer: VERSION_CONFLICT — lost race to concurrent refinement', {
          commandType: parent.commandType,
          projectId: parent.projectId,
        })
        this.emitRejected(parent, 'lost race to concurrent refinement')
        return {
          accepted: false,
          fromVersionId: parent.id,
          reason: 'lost race to concurrent refinement',
        }
      }

      throw error
    }

    this.logger.info('HarnessSynthesizer: accepted candidate', {
      commandType: parent.commandType,
      deltaH,
      fromVersion: parent.version,
      projectId: parent.projectId,
      toVersion: candidateVersion.version,
    })

    this.eventBus.emit('harness:refinement-completed', {
      accepted: true,
      commandType: parent.commandType,
      fromHeuristic: parent.heuristic,
      fromVersion: parent.version,
      projectId: parent.projectId,
      toHeuristic: candidateHeuristic,
      toVersion: candidateVersion.version,
    })

    return {
      accepted: true,
      deltaH,
      fromVersionId: parent.id,
      toVersionId: candidateVersion.id,
    }
  }

  private async doRefine(
    projectId: string,
    commandType: 'chat' | 'curate' | 'query',
  ): Promise<SynthesisResult | undefined> {
    // 3. Fetch parent version
    const parent = await this.harnessStore.getLatest(projectId, commandType)
    if (parent === undefined) {
      this.logger.debug('HarnessSynthesizer: no parent version, skipping', {commandType, projectId})
      return undefined
    }

    // 4. Fetch outcomes and scenarios
    const [outcomes, scenarios] = await Promise.all([
      this.harnessStore.listOutcomes(projectId, commandType, OUTCOMES_WINDOW),
      this.harnessStore.listScenarios(projectId, commandType),
    ])

    // 5. Compute baseline H
    const baselineH = computeHeuristic(outcomes, Date.now())

    // 6. Skip if not worth refining — high baseline with no failure
    // scenarios means the harness is performing well and the Critic +
    // Refiner LLM calls would be wasted.
    if (baselineH !== null && baselineH >= SKIP_REFINEMENT_THRESHOLD) {
      const hasFailingScenarios = scenarios.some(
        (s) => s.expectedBehavior !== 'Succeeds without errors',
      )
      if (!hasFailingScenarios) {
        this.logger.debug('HarnessSynthesizer: baseline H high and all scenarios passing, skipping', {
          baselineH,
          commandType,
          projectId,
        })
        return undefined
      }
    }

    // 7. Critic call
    const criticPrompt = buildCriticPrompt({
      heuristic: baselineH ?? parent.heuristic,
      parentCode: parent.code,
      recentOutcomes: outcomes,
      scenarios,
    })
    const criticAnalysis = await this.refinerClient.completeCritic(criticPrompt)

    // 8. Refiner call
    const refinerPrompt = buildRefinerPrompt({
      criticAnalysis,
      parentCode: parent.code,
      projectType: parent.projectType,
      sdkDocumentation: TOOLS_SDK_DOCUMENTATION,
    })
    let candidateCode = await this.refinerClient.completeRefiner(refinerPrompt)

    // 9. Markdown-fence fallback strip
    const fenceMatch = MARKDOWN_FENCE_RE.exec(candidateCode)
    if (fenceMatch) {
      candidateCode = fenceMatch[1]
      this.logger.debug('HarnessSynthesizer: stripped markdown fences from refiner output')
    }

    // 10. Evaluate
    const evalResult = await this.evaluator.evaluate(candidateCode, parent, scenarios)

    // 11. Accept / reject
    if (evalResult.accepted) {
      return this.acceptCandidate({
        candidateCode,
        candidateHeuristic: evalResult.candidateHeuristic,
        deltaH: evalResult.deltaH,
        parent,
      })
    }

    return this.rejectCandidate(parent, evalResult.deltaH)
  }

  private emitRejected(parent: HarnessVersion, reason: string): void {
    this.eventBus.emit('harness:refinement-completed', {
      accepted: false,
      commandType: parent.commandType,
      fromVersion: parent.version,
      projectId: parent.projectId,
      reason,
    })
  }

  private rejectCandidate(parent: HarnessVersion, deltaH: number): SynthesisResult {
    const reason = `delta H was ${deltaH.toFixed(2)}, below acceptance threshold`

    this.logger.info('HarnessSynthesizer: rejected candidate', {
      commandType: parent.commandType,
      deltaH,
      projectId: parent.projectId,
      reason,
    })

    this.emitRejected(parent, reason)

    return {
      accepted: false,
      deltaH,
      fromVersionId: parent.id,
      reason,
    }
  }
}
