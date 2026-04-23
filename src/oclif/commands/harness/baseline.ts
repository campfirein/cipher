/**
 * `brv harness baseline` — AutoHarness V2 Phase 7 Task 7.5 (completion).
 *
 * Replays the last N stored scenarios through two arms — raw Option-C
 * pass-through template vs the current stored harness — and reports
 * the success-rate delta. Tier 1 Q1 brutal-review item from the
 * AutoHarness V2 doc set: "is the harness actually doing anything
 * for me on my scenarios?"
 *
 * The underlying `HarnessBaselineRunner` shipped in the first PR for
 * ENG-2325. This file is the oclif wrapper owed by the task AC — it
 * was deferred in the earlier PR on the (incorrect) judgment that
 * 7.1's CLI transport pattern had to land first, and Phat called
 * the gap when the command wasn't there.
 *
 * ## Tool factory choice
 *
 * The runner needs a `HarnessToolsFactory` to execute the harness
 * module per scenario. Two reasonable options:
 *
 *   - **Production-style**: boot `SandboxService`, wire
 *     `buildHarnessTools({dryRun: true})`. More authentic — tool
 *     calls go through the real sandbox plumbing in dry-run mode.
 *   - **Stub-only**: the command's success semantic is "harness
 *     function invocation completed without throwing" — a no-op
 *     tool surface is sufficient to detect crashes, syntax errors,
 *     and bad tool lookups.
 *
 * We take the stub path: lighter CLI footprint, same success/
 * failure signal shape, no sandbox startup. If we ever want the
 * baseline to measure tool-interaction quality (not just crash
 * rates), the factory is a one-line swap to the production wiring.
 */

import {Command, Flags} from '@oclif/core'

import type {HarnessContextTools} from '../../../agent/core/domain/harness/types.js'
import type {
  BaselineReport,
  BaselineScenarioResult,
} from '../../../agent/infra/harness/harness-baseline-runner.js'

import {NoOpLogger} from '../../../agent/core/interfaces/i-logger.js'
import {
  BASELINE_MAX_COUNT,
  HarnessBaselineRunner,
  HarnessBaselineRunnerError,
} from '../../../agent/infra/harness/harness-baseline-runner.js'
import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {
  HARNESS_COMMAND_TYPES,
  type HarnessCommandType,
  isHarnessCommandType,
  openHarnessStoreForProject,
} from '../../lib/harness-cli.js'

const DEFAULT_COUNT = 10

/**
 * §C2-shaped per-scenario entry for JSON output. The runner's
 * internal `BaselineScenarioResult` carries stderr fields for text
 * rendering; the pinned handoff shape trims to outcome only.
 */
export interface BaselineJsonPerScenario {
  readonly harnessOutcome: 'failure' | 'success'
  readonly rawOutcome: 'failure' | 'success'
  readonly scenarioId: string
}

export interface BaselineJsonReport {
  readonly delta: number
  readonly harnessSuccessRate: number
  readonly perScenario: readonly BaselineJsonPerScenario[]
  readonly rawSuccessRate: number
  readonly scenarioCount: number
}

export function toBaselineJsonReport(report: BaselineReport): BaselineJsonReport {
  return {
    delta: report.delta,
    harnessSuccessRate: report.harnessSuccessRate,
    perScenario: report.perScenario.map((r) => ({
      harnessOutcome: r.harnessSuccess ? 'success' : 'failure',
      rawOutcome: r.rawSuccess ? 'success' : 'failure',
      scenarioId: r.scenarioId,
    })),
    rawSuccessRate: report.rawSuccessRate,
    scenarioCount: report.scenarioCount,
  }
}

function signedFixed2(n: number): string {
  return n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2)
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

function symbol(ok: boolean): string {
  return ok ? '✓' : '✗'
}

export function renderBaselineText(report: BaselineReport): string {
  const lines: string[] = [
    `scenarios: ${report.scenarioCount}`,
    `raw:       ${pct(report.rawSuccessRate)}`,
    `harness:   ${pct(report.harnessSuccessRate)}`,
    `delta:     ${signedFixed2(report.delta)}  (${pct(report.delta)})`,
    '',
    '── per-scenario ─────────────────────────────────────',
  ]

  const rows = report.perScenario.map((r) => formatScenarioRow(r))
  lines.push(...rows)

  return lines.join('\n')
}

function formatScenarioRow(r: BaselineScenarioResult): string {
  const base = `${symbol(r.rawSuccess)} raw  ${symbol(r.harnessSuccess)} harness  ${r.scenarioId}`
  const errors: string[] = []
  if (r.rawStderr !== undefined) errors.push(`raw: ${r.rawStderr}`)
  if (r.harnessStderr !== undefined) errors.push(`harness: ${r.harnessStderr}`)
  return errors.length === 0 ? base : `${base}\n    ${errors.join(' | ')}`
}

/**
 * Stub `HarnessToolsFactory` for CLI use. No-op tools mean the
 * baseline measures crash rate and tool-call-shape correctness,
 * not tool output quality. See the module header for the
 * production-wiring alternative.
 */
function makeStubToolsFactory(): () => HarnessContextTools {
  return () => ({
    async curate() {
      return {
        applied: [],
        summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
      }
    },
    async readFile() {
      throw new Error('readFile unavailable in baseline stub — harness should not read files in a dry-run baseline.')
    },
  })
}

export default class HarnessBaseline extends Command {
  static description = 'Replay stored scenarios through raw vs harness arms and report the success-rate delta'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --count 20',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  static flags = {
    commandType: Flags.string({
      default: 'curate',
      description: 'Harness pair command type',
      options: [...HARNESS_COMMAND_TYPES],
    }),
    count: Flags.integer({
      default: DEFAULT_COUNT,
      description: `Number of most-recent scenarios to replay (1-${BASELINE_MAX_COUNT})`,
      max: BASELINE_MAX_COUNT,
      min: 1,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(HarnessBaseline)
    if (!isHarnessCommandType(flags.commandType)) {
      this.error(`invalid --commandType value '${flags.commandType}'`, {exit: 1})
    }

    const {commandType} = flags
    const format = flags.format === 'json' ? 'json' : 'text'

    const projectRoot = resolveProject()?.projectRoot ?? process.cwd()
    const opened = await openHarnessStoreForProject(projectRoot)
    if (opened === undefined) {
      this.error(
        `no harness storage for this project (${projectRoot}) — run curate once to bootstrap.`,
        {exit: 1},
      )
    }

    try {
      const runner = new HarnessBaselineRunner(opened.store, new NoOpLogger(), makeStubToolsFactory())
      const report = await runner.runBaseline({
        commandType: commandType as HarnessCommandType,
        count: flags.count,
        projectId: opened.projectId,
      })

      if (format === 'json') {
        this.log(JSON.stringify(toBaselineJsonReport(report), null, 2))
      } else {
        this.log(renderBaselineText(report))
      }
    } catch (error) {
      if (error instanceof HarnessBaselineRunnerError) {
        // All runner-level errors are user-input / state problems
        // per §C1 — exit 1 with the runner's own message (already
        // includes remediation hints, e.g. "Run curate N more times").
        this.error(error.message, {exit: 1})
      }

      throw error
    } finally {
      opened.close()
    }
  }
}
