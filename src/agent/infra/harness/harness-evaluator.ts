/**
 * AutoHarness V2 — HarnessEvaluator.
 *
 * Scores a candidate harness by running it against `EvaluationScenario`
 * records, 10 times per scenario, and returning the mean Δ H vs. the
 * baseline parent version.
 *
 * The 10-run mean prevents accepting a candidate whose improvement was
 * a single-sample noise spike. The evaluator writes no data — storing
 * accepted candidates is the synthesizer's job.
 *
 * See `v1-design-decisions.md §2.3` for the numeric parameters.
 */

import type {
  HarnessContext,
  HarnessContextTools,
  HarnessModule,
  HarnessVersion,
  ValidatedEvaluationScenario,
} from '../../core/domain/harness/types.js'
import type {IHarnessStore} from '../../core/interfaces/i-harness-store.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'

import {computeHeuristic} from '../../core/domain/harness/heuristic.js'
import {HarnessModuleBuilder} from './harness-module-builder.js'

// ---------------------------------------------------------------------------
// Constants — load-bearing; changes need a design review
// ---------------------------------------------------------------------------

/** Number of times each scenario is run against the candidate. */
const EVAL_RUNS_PER_SCENARIO = 10

/** Minimum Δ H for a candidate to be accepted. */
const ACCEPTANCE_DELTA = 0.05

/** Window size for baseline heuristic computation (matches mode selector). */
const BASELINE_WINDOW = 50

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EvaluationRunResult {
  readonly executionTimeMs: number
  readonly stderr?: string
  readonly success: boolean
}

export interface EvaluationDetail {
  readonly perScenarioHeuristic: number
  readonly runs: readonly EvaluationRunResult[]
  readonly scenarioId: string
}

export interface EvaluationResult {
  readonly accepted: boolean
  readonly baselineHeuristic: number
  readonly candidateHeuristic: number
  readonly deltaH: number
  readonly details: readonly EvaluationDetail[]
}

/**
 * Factory that returns `HarnessContextTools` for evaluation runs.
 * In production, the factory delegates to `SandboxService.buildHarnessTools`
 * with `{dryRun: true}`. In tests, stubs control tool behavior.
 */
export type HarnessToolsFactory = () => HarnessContextTools

// ---------------------------------------------------------------------------
// HarnessEvaluator
// ---------------------------------------------------------------------------

export class HarnessEvaluator {
  private readonly moduleBuilder: HarnessModuleBuilder

  constructor(
    private readonly harnessStore: IHarnessStore,
    private readonly logger: ILogger,
    private readonly toolsFactory: HarnessToolsFactory,
  ) {
    this.moduleBuilder = new HarnessModuleBuilder(logger)
  }

  async evaluate(
    candidateCode: string,
    parentVersion: HarnessVersion,
    scenarios: readonly ValidatedEvaluationScenario[],
  ): Promise<EvaluationResult> {
    // 1. Build candidate module
    const candidateVersion = this.buildCandidateVersion(candidateCode, parentVersion)
    const buildResult = this.moduleBuilder.build(candidateVersion)

    if (!buildResult.loaded) {
      this.logger.info('Candidate load failed', {reason: buildResult.reason})
      const baselineH = await this.computeBaselineHeuristic(parentVersion)
      return {
        accepted: false,
        baselineHeuristic: baselineH,
        candidateHeuristic: 0,
        deltaH: -baselineH,
        details: [],
      }
    }

    // 2. Run all scenarios concurrently via Promise.all
    const details = await this.runAllScenarios(buildResult.module, scenarios)

    // 3. Compute heuristics
    const candidateH = this.computeCandidateHeuristic(details)
    const baselineH = await this.computeBaselineHeuristic(parentVersion)
    const deltaH = candidateH - baselineH

    this.logger.debug('Evaluation complete', {
      accepted: deltaH >= ACCEPTANCE_DELTA,
      baselineH,
      candidateH,
      deltaH,
      scenarios: scenarios.length,
    })

    return {
      accepted: deltaH >= ACCEPTANCE_DELTA,
      baselineHeuristic: baselineH,
      candidateHeuristic: candidateH,
      deltaH,
      details,
    }
  }

  /**
   * Construct a synthetic `HarnessVersion` from the candidate code,
   * inheriting identity fields from the parent. The evaluator never
   * persists this — it's only used to feed the module builder.
   */
  private buildCandidateVersion(
    candidateCode: string,
    parentVersion: HarnessVersion,
  ): HarnessVersion {
    return {
      ...parentVersion,
      code: candidateCode,
      createdAt: Date.now(),
      id: `eval-candidate-${Date.now()}`,
      parentId: parentVersion.id,
      version: parentVersion.version + 1,
    }
  }

  /**
   * Compute the baseline heuristic from the parent version's recent outcomes.
   * Uses the same `computeHeuristic` helper as the mode selector so the
   * evaluator and production agree on "how good is the current version".
   */
  private async computeBaselineHeuristic(parentVersion: HarnessVersion): Promise<number> {
    const outcomes = await this.harnessStore.listOutcomes(
      parentVersion.projectId,
      parentVersion.commandType,
      BASELINE_WINDOW,
    )
    const h = computeHeuristic(outcomes, Date.now())
    return h ?? 0
  }

  /**
   * Compute the candidate's heuristic from per-scenario details.
   * Returns the mean of per-scenario heuristics.
   */
  private computeCandidateHeuristic(details: readonly EvaluationDetail[]): number {
    if (details.length === 0) return 0
    const sum = details.reduce((acc, d) => acc + d.perScenarioHeuristic, 0)
    return sum / details.length
  }

  /**
   * Execute a single evaluation run: construct a fresh `HarnessContext`,
   * invoke the candidate module's function, and measure the outcome.
   */
  private async executeSingleRun(
    module: HarnessModule,
    scenario: ValidatedEvaluationScenario,
  ): Promise<EvaluationRunResult> {
    const tools = this.toolsFactory()
    const ctx: HarnessContext = {
      abort: new AbortController().signal,
      env: {
        commandType: scenario.commandType,
        projectType: scenario.projectType,
        workingDirectory: '/eval',
      },
      tools,
    }

    const start = performance.now()

    try {
      const fn = scenario.commandType === 'query' ? module.query : module.curate
      if (fn === undefined) {
        return {
          executionTimeMs: performance.now() - start,
          stderr: `No ${scenario.commandType} function on candidate module`,
          success: false,
        }
      }

      await fn(ctx)

      return {
        executionTimeMs: performance.now() - start,
        success: true,
      }
    } catch (error: unknown) {
      const stderr = error instanceof Error ? error.message : String(error)
      return {
        executionTimeMs: performance.now() - start,
        stderr,
        success: false,
      }
    }
  }

  /**
   * Run all scenarios concurrently. Each scenario's runs are independent;
   * `Promise.all` is safe because each run gets its own tools + context.
   */
  private async runAllScenarios(
    module: HarnessModule,
    scenarios: readonly ValidatedEvaluationScenario[],
  ): Promise<EvaluationDetail[]> {
    const scenarioPromises = scenarios.map((scenario) =>
      this.runScenario(module, scenario),
    )
    return Promise.all(scenarioPromises)
  }

  /**
   * Run a single scenario `EVAL_RUNS_PER_SCENARIO` times and compute
   * the per-scenario heuristic from the runs' success/failure flags.
   */
  private async runScenario(
    module: HarnessModule,
    scenario: ValidatedEvaluationScenario,
  ): Promise<EvaluationDetail> {
    // Runs execute concurrently — each gets a fresh HarnessContext + tools.
    const runPromises = Array.from({length: EVAL_RUNS_PER_SCENARIO}, () =>
      this.executeSingleRun(module, scenario),
    )
    const runs = await Promise.all(runPromises)

    // Compute per-scenario H: treat each run as a mini-outcome
    const successCount = runs.filter((r) => r.success).length
    const perScenarioHeuristic = successCount / EVAL_RUNS_PER_SCENARIO

    return {
      perScenarioHeuristic,
      runs,
      scenarioId: scenario.id,
    }
  }
}
