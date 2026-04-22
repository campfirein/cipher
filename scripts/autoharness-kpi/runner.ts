#!/usr/bin/env node
/**
 * AutoHarness V2 — KPI harness (Phase 8 Task 8.4).
 *
 * Runs the reference fixture (`scripts/autoharness-kpi/fixture-tasks.json`)
 * through two arms:
 *   - Arm A: raw `tools.*` orchestration (no harness)
 *   - Arm B: current harness version
 *
 * Reports the success-rate delta. v1.0 ship gate:
 *   delta >= 0.30   → exit 0
 *   delta <  0.30   → exit 1 (block the release)
 *
 * Usage:
 *   npm run kpi:harness -- [--fixture <path>]
 *                          [--runs <N>]
 *                          [--output <path>]
 *                          [--llm stub|real]
 *
 * Defaults: `--llm stub` (deterministic synthetic arm results for
 * CI validation of the script itself). Real-LLM measurement runs
 * are triggered pre-ship via `--llm real` and require the agent
 * stack to be wired — landing in a follow-up PR.
 */

import {readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface FixtureTask {
  readonly expectedBehavior: string
  readonly id: string
  readonly taskDescription: string
}

export interface Fixture {
  readonly commandType: 'chat' | 'curate' | 'query'
  readonly fixtureVersion: string
  readonly targetModel: string
  readonly tasks: readonly FixtureTask[]
}

export type ArmName = 'harness' | 'raw'

export interface ArmRunResult {
  readonly runs: readonly boolean[] // true = success
  readonly successRate: number // mean across runs
  readonly taskId: string
}

export interface ArmResult {
  readonly arm: ArmName
  readonly overallSuccessRate: number
  readonly perTask: readonly ArmRunResult[]
}

export interface KpiReport {
  readonly delta: number
  readonly fixtureVersion: string
  readonly harnessSuccessRate: number
  readonly measuredAt: number // Date.now()
  readonly perTask: ReadonlyArray<{
    readonly harnessSuccessRate: number
    readonly rawSuccessRate: number
    readonly taskId: string
  }>
  readonly rawSuccessRate: number
  readonly runsPerArm: number
  readonly targetModel: string
}

/**
 * Shape of an LLM backend the KPI runner delegates to. Stubbed in
 * the default `--llm stub` path; real path (follow-up PR) wires this
 * into the agent stack with a Llama 3.1 8B provider.
 */
export interface KpiLlmClient {
  runTask(task: FixtureTask, arm: ArmName): Promise<boolean>
}

// ─────────────────────────────────────────────────────────────────────────
// Constants — ship-gate delta + stub arm success rates
// ─────────────────────────────────────────────────────────────────────────

/** v1.0 ship-gate threshold per `v1-design-decisions.md §2.7`. */
export const SHIP_GATE_DELTA = 0.3

// Stub success rates, per task id. Deterministic so the script's
// exit-code logic is testable. Mix designed to produce
// delta = 0.50 (well above ship gate) on the default 10-run config:
//   - Tasks t01-t10: raw always fails, harness always succeeds (delta 100%)
//   - Tasks t11-t20: both arms always succeed (delta 0%)
//   - Mean delta across 20 tasks = 0.50
const STUB_RATES: Readonly<Record<string, {harness: number; raw: number;}>> = {
  t01: {harness: 1, raw: 0},
  t02: {harness: 1, raw: 0},
  t03: {harness: 1, raw: 0},
  t04: {harness: 1, raw: 0},
  t05: {harness: 1, raw: 0},
  t06: {harness: 1, raw: 0},
  t07: {harness: 1, raw: 0},
  t08: {harness: 1, raw: 0},
  t09: {harness: 1, raw: 0},
  t10: {harness: 1, raw: 0},
  t11: {harness: 1, raw: 1},
  t12: {harness: 1, raw: 1},
  t13: {harness: 1, raw: 1},
  t14: {harness: 1, raw: 1},
  t15: {harness: 1, raw: 1},
  t16: {harness: 1, raw: 1},
  t17: {harness: 1, raw: 1},
  t18: {harness: 1, raw: 1},
  t19: {harness: 1, raw: 1},
  t20: {harness: 1, raw: 1},
}

// ─────────────────────────────────────────────────────────────────────────
// Pure functions (unit-tested)
// ─────────────────────────────────────────────────────────────────────────

/** Parse and validate a fixture file. Throws on schema mismatch. */
export function loadFixture(path: string): Fixture {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError(`fixture is not an object: ${path}`)
  }

  const parsed = raw as Record<string, unknown>
  const {tasks} = parsed
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error(`fixture has no tasks: ${path}`)
  }

  for (const task of tasks) {
    if (
      typeof task !== 'object' ||
      task === null ||
      typeof (task as FixtureTask).id !== 'string' ||
      typeof (task as FixtureTask).taskDescription !== 'string' ||
      typeof (task as FixtureTask).expectedBehavior !== 'string'
    ) {
      throw new Error(`fixture task malformed: ${JSON.stringify(task)}`)
    }
  }

  return {
    commandType: (parsed.commandType as Fixture['commandType']) ?? 'curate',
    fixtureVersion: (parsed.fixtureVersion as string) ?? 'unversioned',
    targetModel: (parsed.targetModel as string) ?? 'unknown',
    tasks: tasks as FixtureTask[],
  }
}

/**
 * Deterministic stub LLM client. Used by `--llm stub` and by unit
 * tests. Keeps the script's delta math + exit logic testable
 * without touching a real model.
 */
export function makeStubLlmClient(): KpiLlmClient {
  return {
    async runTask(task: FixtureTask, arm: ArmName): Promise<boolean> {
      const idKey = task.id.split('-')[0] // e.g. "t01" from "t01-list-exports"
      const rates = idKey === undefined ? undefined : STUB_RATES[idKey]
      if (rates === undefined) {
        // Unknown task id → baseline "both arms succeed" to keep
        // stub output predictable for custom fixtures.
        return true
      }

      return arm === 'raw' ? rates.raw === 1 : rates.harness === 1
    },
  }
}

/** Run one arm over the full fixture, `runs` times per task. */
export async function runArm(
  arm: ArmName,
  tasks: readonly FixtureTask[],
  runs: number,
  client: KpiLlmClient,
): Promise<ArmResult> {
  const perTask: ArmRunResult[] = []

  for (const task of tasks) {
    const results: boolean[] = []
    for (let i = 0; i < runs; i++) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await client.runTask(task, arm)
      results.push(ok)
    }

    const successRate = results.filter(Boolean).length / results.length
    perTask.push({runs: results, successRate, taskId: task.id})
  }

  const totalRuns = perTask.reduce((acc, t) => acc + t.runs.length, 0)
  const totalSuccesses = perTask.reduce(
    (acc, t) => acc + t.runs.filter(Boolean).length,
    0,
  )
  const overallSuccessRate = totalRuns === 0 ? 0 : totalSuccesses / totalRuns

  return {arm, overallSuccessRate, perTask}
}

/** Combine two arm results into the final KPI report. */
export function computeKpiReport(args: {
  readonly fixture: Fixture
  readonly harnessArm: ArmResult
  readonly measuredAt?: number
  readonly rawArm: ArmResult
  readonly runsPerArm: number
}): KpiReport {
  const {fixture, harnessArm, rawArm, runsPerArm} = args
  const harnessSuccessRate = harnessArm.overallSuccessRate
  const rawSuccessRate = rawArm.overallSuccessRate

  const byTaskId = new Map(rawArm.perTask.map((t) => [t.taskId, t.successRate]))
  const perTask = harnessArm.perTask.map((h) => ({
    harnessSuccessRate: h.successRate,
    rawSuccessRate: byTaskId.get(h.taskId) ?? 0,
    taskId: h.taskId,
  }))

  return {
    delta: harnessSuccessRate - rawSuccessRate,
    fixtureVersion: fixture.fixtureVersion,
    harnessSuccessRate,
    measuredAt: args.measuredAt ?? Date.now(),
    perTask,
    rawSuccessRate,
    runsPerArm,
    targetModel: fixture.targetModel,
  }
}

/** Exit code from a report: 0 if delta ≥ ship gate, else 1. */
export function exitCodeForReport(report: KpiReport): 0 | 1 {
  return report.delta >= SHIP_GATE_DELTA ? 0 : 1
}

/** Human-readable table for stdout. */
export function renderReport(report: KpiReport): string {
  const lines: string[] = []
  lines.push(
    `KPI report — fixture ${report.fixtureVersion} × model ${report.targetModel}`,
    `runs/arm: ${report.runsPerArm}`,
    '',
    `task                         raw     harness`,
    `─`.repeat(50),
  )
  for (const t of report.perTask) {
    const id = t.taskId.padEnd(28)
    const raw = `${Math.round(t.rawSuccessRate * 100)}%`.padStart(5)
    const harness = `${Math.round(t.harnessSuccessRate * 100)}%`.padStart(8)
    lines.push(`${id} ${raw}   ${harness}`)
  }

  lines.push(
    `─`.repeat(50),
    `overall:                     ${(report.rawSuccessRate * 100).toFixed(1).padStart(5)}%  ${(report.harnessSuccessRate * 100).toFixed(1).padStart(7)}%`,
    `delta:                       ${(report.delta >= 0 ? '+' : '') + (report.delta * 100).toFixed(1)}pp`,
    report.delta >= SHIP_GATE_DELTA
      ? `✓ ship gate met (>= ${SHIP_GATE_DELTA * 100}pp)`
      : `✗ ship gate NOT met — shortfall ${((SHIP_GATE_DELTA - report.delta) * 100).toFixed(1)}pp`,
  )

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

interface CliArgs {
  readonly fixture: string
  readonly llm: 'real' | 'stub'
  readonly output?: string
  readonly runs: number
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let fixture = 'scripts/autoharness-kpi/fixture-tasks.json'
  let output: string | undefined
  let runs = 10
  let llm: CliArgs['llm'] = 'stub'

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
    case '--fixture': {
      const next = argv[i + 1]
      if (next === undefined) throw new Error('--fixture requires a path')
      fixture = next
      i++
    
    break;
    }

    case '--llm': {
      const next = argv[i + 1]
      if (next !== 'stub' && next !== 'real') {
        throw new Error(`--llm must be 'stub' or 'real', got: ${next ?? '<missing>'}`)
      }

      llm = next
      i++
    
    break;
    }

    case '--output': {
      const next = argv[i + 1]
      if (next === undefined) throw new Error('--output requires a path')
      output = next
      i++
    
    break;
    }

    case '--runs': {
      const next = argv[i + 1]
      if (next === undefined) throw new Error('--runs requires a number')
      runs = Number.parseInt(next, 10)
      if (!Number.isFinite(runs) || runs <= 0) {
        throw new Error(`--runs must be a positive integer, got: ${next}`)
      }

      i++
    
    break;
    }
    // No default
    }
  }

  return {fixture, llm, output, runs}
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  const fixture = loadFixture(resolve(args.fixture))

  let client: KpiLlmClient
  if (args.llm === 'stub') {
    client = makeStubLlmClient()
  } else {
    // Real-LLM path — requires the agent stack wired for Llama 3.1 8B.
    // Lands in a follow-up PR once the KPI run is exercised pre-ship.
    throw new Error(
      "--llm real is not yet implemented in this PR — use --llm stub for script validation. " +
        'The real-LLM path will wire into the agent LLM service in a follow-up; see task_04-kpi-harness.md.',
    )
  }

  const rawArm = await runArm('raw', fixture.tasks, args.runs, client)
  const harnessArm = await runArm('harness', fixture.tasks, args.runs, client)
  const report = computeKpiReport({
    fixture,
    harnessArm,
    rawArm,
    runsPerArm: args.runs,
  })

   
  console.log(renderReport(report))
  if (args.output !== undefined) {
    writeFileSync(resolve(args.output), JSON.stringify(report, null, 2))
  }

  return exitCodeForReport(report)
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point (only runs when invoked directly via `tsx`/`node`)
// ─────────────────────────────────────────────────────────────────────────

// `process.exit()` is the right API for a CLI that needs explicit
// ship-gate exit codes (0 / 1 / 2). `unicorn/prefer-top-level-await`
// is fine here because the guarded block only runs in the direct-
// invocation path, not when test files import this module.

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  try {
    const code = await main(process.argv.slice(2))
    // eslint-disable-next-line n/no-process-exit
    process.exit(code)
  } catch (error) {
    console.error(
      `kpi-harness failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    // eslint-disable-next-line n/no-process-exit
    process.exit(2)
  }
}
