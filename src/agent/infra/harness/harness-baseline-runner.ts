/**
 * AutoHarness V2 — HarnessBaselineRunner.
 *
 * Powers `brv harness baseline` (Tier 1 Q1 brutal-review item).
 * Replays the last N stored scenarios through two arms:
 *   - Raw: the Option C pass-through template for the current
 *          `projectType`
 *   - Harness: the pair's current (latest) stored version
 *
 * Each scenario runs once per arm. Success = harness function
 * invocation completed without throwing. Returns per-scenario
 * outcomes + overall rates + `delta = harness - raw`.
 *
 * Complementary to the reference KPI harness (`scripts/autoharness-kpi/`):
 *   - That runs a FIXED task set on a FIXED model for the release-
 *     notes headline.
 *   - This runs the USER's scenarios against the USER's current
 *     harness for the personal "is it working for me?" signal.
 *
 * `dryRun` enforcement is the caller's responsibility — production
 * wires `HarnessToolsFactory` to `SandboxService.buildHarnessTools({dryRun: true})`.
 */

import type {HarnessContext, ProjectType, ValidatedEvaluationScenario} from '../../core/domain/harness/types.js'
import type {IHarnessStore} from '../../core/interfaces/i-harness-store.js'
import type {ILogger} from '../../core/interfaces/i-logger.js'
import type {HarnessToolsFactory} from './harness-evaluator.js'

import {HarnessModuleBuilder} from './harness-module-builder.js'
import {getTemplate, type SupportedCommandType} from './templates/index.js'

// ─── Public types ────────────────────────────────────────────────────────

export interface BaselineScenarioResult {
  readonly harnessStderr?: string
  readonly harnessSuccess: boolean
  readonly rawStderr?: string
  readonly rawSuccess: boolean
  readonly scenarioId: string
}

export interface BaselineReport {
  readonly delta: number
  readonly harnessSuccessRate: number
  readonly perScenario: readonly BaselineScenarioResult[]
  readonly rawSuccessRate: number
  readonly scenarioCount: number
}

export type BaselineRunnerErrorCode =
  | 'COUNT_OUT_OF_RANGE'
  | 'INSUFFICIENT_SCENARIOS'
  | 'NO_CURRENT_VERSION'
  | 'UNSUPPORTED_COMMAND_TYPE'

export class HarnessBaselineRunnerError extends Error {
  constructor(
    message: string,
    public readonly code: BaselineRunnerErrorCode,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'HarnessBaselineRunnerError'
  }
}

// ─── Constants ───────────────────────────────────────────────────────────

/** Smallest scenario count that produces a meaningful baseline number. */
export const BASELINE_MIN_SCENARIOS = 3

/** Hard ceiling on `--count` — 10 runs × 50 scenarios × 2 arms = 1000 runs, already slow. */
export const BASELINE_MAX_COUNT = 50

// ─── Runner ──────────────────────────────────────────────────────────────

/**
 * v1.0 scope narrowing (per Phase 4 Task 4.3): only `curate` templates
 * exist, so baseline only supports `commandType === 'curate'` for now.
 * When query templates ship, widen this set.
 */
const SUPPORTED_BASELINE_COMMANDS: ReadonlySet<string> = new Set<SupportedCommandType>(['curate'])

export class HarnessBaselineRunner {
  private readonly moduleBuilder: HarnessModuleBuilder

  constructor(
    private readonly harnessStore: IHarnessStore,
    private readonly logger: ILogger,
    private readonly toolsFactory: HarnessToolsFactory,
  ) {
    this.moduleBuilder = new HarnessModuleBuilder(logger)
  }

  async runBaseline(params: {
    readonly commandType: 'chat' | 'curate' | 'query'
    readonly count: number
    readonly projectId: string
  }): Promise<BaselineReport> {
    const {commandType, count, projectId} = params

    if (count < 1 || count > BASELINE_MAX_COUNT) {
      throw new HarnessBaselineRunnerError(
        `--count must be in [1, ${BASELINE_MAX_COUNT}], got ${count}`,
        'COUNT_OUT_OF_RANGE',
        {count, max: BASELINE_MAX_COUNT},
      )
    }

    if (!SUPPORTED_BASELINE_COMMANDS.has(commandType)) {
      throw new HarnessBaselineRunnerError(
        `baseline is only supported for commandType 'curate' in v1.0 (got '${commandType}'). Query/chat templates land in a follow-up.`,
        'UNSUPPORTED_COMMAND_TYPE',
        {commandType},
      )
    }

    const allScenarios = await this.harnessStore.listScenarios(projectId, commandType)
    const scenarios = allScenarios.slice(0, count)

    if (scenarios.length < BASELINE_MIN_SCENARIOS) {
      throw new HarnessBaselineRunnerError(
        `not enough scenarios — baseline needs at least ${BASELINE_MIN_SCENARIOS}, found ${scenarios.length}. Run curate ${BASELINE_MIN_SCENARIOS - scenarios.length} more time(s) first.`,
        'INSUFFICIENT_SCENARIOS',
        {found: scenarios.length, required: BASELINE_MIN_SCENARIOS},
      )
    }

    const currentVersion = await this.harnessStore.getLatest(projectId, commandType)
    if (currentVersion === undefined) {
      throw new HarnessBaselineRunnerError(
        `no current harness version for (${projectId}, ${commandType}) — bootstrap first by running curate once.`,
        'NO_CURRENT_VERSION',
        {commandType, projectId},
      )
    }

    const rawCode = getTemplate(
      commandType as SupportedCommandType,
      currentVersion.projectType,
    ).code

    // Build both modules. Either failing to build is a bug-level
    // error — the current version came from the store (previously
    // validated), and the raw template is a shipped constant.
    const rawBuild = this.moduleBuilder.build({
      ...currentVersion,
      code: rawCode,
      id: `${currentVersion.id}:raw`,
    })
    if (!rawBuild.loaded) {
      throw new Error(`raw template failed to build: ${rawBuild.reason}`)
    }

    const harnessBuild = this.moduleBuilder.build(currentVersion)
    if (!harnessBuild.loaded) {
      throw new Error(`current version failed to build: ${harnessBuild.reason}`)
    }

    // Run each scenario once per arm. Serial over scenarios to keep
    // outcomes traceable in logs; concurrent per-arm inside each
    // scenario would add ordering noise for tiny latency savings.
    const perScenario: BaselineScenarioResult[] = []
    for (const scenario of scenarios) {
      // eslint-disable-next-line no-await-in-loop
      const rawRun = await this.runSingleScenario(rawBuild.module, scenario)
      // eslint-disable-next-line no-await-in-loop
      const harnessRun = await this.runSingleScenario(harnessBuild.module, scenario)
      perScenario.push({
        harnessStderr: harnessRun.stderr,
        harnessSuccess: harnessRun.success,
        rawStderr: rawRun.stderr,
        rawSuccess: rawRun.success,
        scenarioId: scenario.id,
      })
    }

    const rawSuccesses = perScenario.filter((r) => r.rawSuccess).length
    const harnessSuccesses = perScenario.filter((r) => r.harnessSuccess).length
    const rawSuccessRate = rawSuccesses / perScenario.length
    const harnessSuccessRate = harnessSuccesses / perScenario.length

    return {
      delta: harnessSuccessRate - rawSuccessRate,
      harnessSuccessRate,
      perScenario,
      rawSuccessRate,
      scenarioCount: perScenario.length,
    }
  }

  /**
   * Execute one scenario against one arm's module. Mirrors the
   * logic in HarnessEvaluator.executeSingleRun (intentionally not
   * shared — evaluator uses 10-run means; baseline uses single-run
   * side-by-side, different semantics, different test surface).
   */
  private async runSingleScenario(
    module: import('../../core/domain/harness/types.js').HarnessModule,
    scenario: ValidatedEvaluationScenario,
  ): Promise<{stderr?: string; success: boolean}> {
    const tools = this.toolsFactory()
    const ctx: HarnessContext = {
      abort: new AbortController().signal,
      env: {
        commandType: scenario.commandType as 'chat' | 'curate' | 'query',
        projectType: scenario.projectType as ProjectType,
        workingDirectory: '/baseline',
      },
      tools,
    }

    try {
      const fn = scenario.commandType === 'query' ? module.query : module.curate
      if (fn === undefined) {
        return {stderr: `no ${scenario.commandType} function on module`, success: false}
      }

      await fn(ctx)
      return {success: true}
    } catch (error) {
      return {
        stderr: error instanceof Error ? error.message : String(error),
        success: false,
      }
    }
  }
}
