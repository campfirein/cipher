#!/usr/bin/env npx ts-node --esm
/**
 * AutoHarness V2 — manual smoke script.
 *
 * Walks the 12-step §4.3 smoke (execution-plan.md) in a single run
 * against an inMemory stack. Engineers run `npm run smoke:harness`
 * before a manual dogfood pass. Exits 0 on full pass, non-zero with
 * the failing step number on failure.
 *
 * Step functions are exported so `test/unit/scripts/harness-smoke.test.ts`
 * can exercise each one in isolation.
 *
 * Usage:
 *   npm run smoke:harness
 *   node --loader ts-node/esm scripts/harness-smoke.ts [--project <dir>] [--llm stub|real]
 */

import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {CodeExecOutcome, EvaluationScenario, HarnessContextTools, HarnessVersion} from '../src/agent/core/domain/harness/types.js'
import type {ValidatedHarnessConfig} from '../src/agent/infra/agent/agent-schemas.js'
import type {HarnessToolsFactory} from '../src/agent/infra/harness/harness-evaluator.js'
import type {IRefinerClient} from '../src/agent/infra/harness/harness-refiner-client.js'

import {computeHeuristic} from '../src/agent/core/domain/harness/heuristic.js'
import {NoOpLogger} from '../src/agent/core/interfaces/i-logger.js'
import {AgentEventBus, SessionEventBus} from '../src/agent/infra/events/event-emitter.js'
import {FileSystemService} from '../src/agent/infra/file-system/file-system-service.js'
import {_clearPolyglotWarningState} from '../src/agent/infra/harness/detect-and-pick-template.js'
import {HarnessBaselineRunner} from '../src/agent/infra/harness/harness-baseline-runner.js'
import {HarnessEvaluator} from '../src/agent/infra/harness/harness-evaluator.js'
import {SYNTHETIC_DELIMITER} from '../src/agent/infra/harness/harness-outcome-recorder.js'
import {
  HarnessBootstrap,
  HarnessModuleBuilder,
  HarnessOutcomeRecorder,
  HarnessScenarioCapture,
  HarnessStore,
  HarnessSynthesizer,
} from '../src/agent/infra/harness/index.js'
import {SandboxService} from '../src/agent/infra/sandbox/sandbox-service.js'
import {HarnessBannerListener} from '../src/agent/infra/session/harness-banner-listener.js'
import {FileKeyStorage} from '../src/agent/infra/storage/file-key-storage.js'
import {buildDiffReport} from '../src/oclif/commands/harness/diff.js'
import {toInspectReport} from '../src/oclif/commands/harness/inspect.js'
import {buildStatusReport} from '../src/oclif/commands/harness/status.js'
import {attachFeedbackToStore} from '../src/oclif/lib/harness-feedback.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmokeState {
  refinementEvents: Array<Record<string, unknown>>
  v1?: HarnessVersion
  v2?: HarnessVersion
}

export interface SmokeContext {
  readonly agentEventBus: AgentEventBus
  readonly bannerLines: string[]
  readonly bannerListener: HarnessBannerListener
  readonly baselineRunner: HarnessBaselineRunner
  readonly bootstrap: HarnessBootstrap
  readonly config: ValidatedHarnessConfig
  readonly keyStorage: FileKeyStorage
  readonly ownsTempDir: boolean
  readonly projectId: string
  readonly sandboxService: SandboxService
  readonly state: SmokeState
  readonly store: HarnessStore
  readonly synthesizer: HarnessSynthesizer
  readonly tempDir: string
}

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------

export class SmokeAssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmokeAssertionError'
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeAssertionError(message)
}

// ---------------------------------------------------------------------------
// Stub refiner LLM
// ---------------------------------------------------------------------------

const V2_CODE = `
exports.meta = function meta() {
  return {
    capabilities: ['curate'],
    commandType: 'curate',
    projectPatterns: ['**/*.ts', '**/*.tsx', 'tsconfig.json'],
    version: 1,
  }
}

exports.curate = async function curate(ctx) {
  if (ctx.env.customConfig == null) return
  return ctx.tools.curate(ctx.env.customConfig.operations)
}
`.trimStart()

const CRITIC_ANALYSIS = [
  'Failure pattern: reads undefined x.',
  'Root cause: missing null check on ctx.env.customConfig.',
  'Suggested change: add if (ctx.env.customConfig == null) return',
].join('\n')

class FakeRefinerLLM implements IRefinerClient {
  criticCallCount = 0
  readonly modelId: string
  refinerCallCount = 0
  private readonly refinerResponse: string

  constructor(opts: {modelId?: string; refinerResponse?: string} = {}) {
    this.modelId = opts.modelId ?? 'test-model-capable'
    this.refinerResponse = opts.refinerResponse ?? V2_CODE
  }

  async completeCritic(_prompt: string): Promise<string> {
    this.criticCallCount++
    return CRITIC_ANALYSIS
  }

  async completeRefiner(_prompt: string): Promise<string> {
    this.refinerCallCount++
    return this.refinerResponse
  }
}

// ---------------------------------------------------------------------------
// Eval tools factory (dryRun stubs)
// ---------------------------------------------------------------------------

// Script-level double-casts: the factory returns simplified stubs whose
// parameter signatures don't match the full HarnessContextTools contract.
const evalToolsFactory: HarnessToolsFactory = () => ({
  curate: (async () => {
    throw new Error('WRITE_BLOCKED_DURING_EVAL')
  }) as unknown as HarnessContextTools['curate'],
  readFile: (async () => ({
    content: '',
    encoding: 'utf8',
    formattedContent: '',
    lines: 0,
    message: '',
    size: 0,
    totalLines: 0,
    truncated: false,
  })) as unknown as HarnessContextTools['readFile'],
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMMAND_TYPE = 'curate' as const
const SESSION_ID = 'smoke-sess-1'

interface EnvironmentContext {
  brvStructure: string
  fileTree: string
  isGitRepository: boolean
  nodeVersion: string
  osVersion: string
  platform: string
  workingDirectory: string
}

function makeEnvironmentContext(workingDirectory: string): EnvironmentContext {
  return {
    brvStructure: '',
    fileTree: '',
    isGitRepository: false,
    nodeVersion: process.version,
    osVersion: 'test',
    platform: process.platform,
    workingDirectory,
  }
}

async function seedOutcomes(params: {
  commandType?: 'curate' | 'query'
  count: number
  failureRatio?: number
  projectId: string
  startIndex?: number
  store: HarnessStore
  usedHarness?: boolean
}): Promise<void> {
  const now = Date.now()
  const commandType = params.commandType ?? COMMAND_TYPE
  const failureRatio = params.failureRatio ?? 0.8
  const startIndex = params.startIndex ?? 0
  const usedHarness = params.usedHarness ?? false
  for (let i = 0; i < params.count; i++) {
    const isFailing = i < Math.floor(params.count * failureRatio)
    const outcome: CodeExecOutcome = {
      code: 'tools.search("x")',
      commandType,
      executionTimeMs: 42,
      id: `smoke-${commandType}-outcome-${startIndex + i}`,
      projectId: params.projectId,
      projectType: 'typescript',
      sessionId: 'smoke-seed',
      stderr: isFailing ? "TypeError: Cannot read properties of undefined (reading 'x')" : undefined,
      success: !isFailing,
      timestamp: now - 50_000 + i * 1000,
      usedHarness,
    }
    // eslint-disable-next-line no-await-in-loop
    await params.store.saveOutcome(outcome)
  }
}

async function seedScenarios(store: HarnessStore, projectId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const isPositive = i < Math.floor(count / 2)
    const scenario: EvaluationScenario = {
      code: 'harness.curate(ctx)',
      commandType: COMMAND_TYPE,
      createdAt: Date.now() - 30_000 + i * 1000,
      expectedBehavior: isPositive
        ? 'Succeeds without errors'
        : 'Throws TypeError on undefined property access',
      id: `smoke-scenario-${i}`,
      projectId,
      projectType: 'typescript',
      taskDescription: isPositive ? 'Normal curate operation' : 'Null-pointer failure case',
    }
    // eslint-disable-next-line no-await-in-loop
    await store.saveScenario(scenario)
  }
}

async function waitForOutcomes(params: {
  expectedMin: number
  projectId: string
  store: HarnessStore
  timeoutMs?: number
}): Promise<CodeExecOutcome[]> {
  const deadline = Date.now() + (params.timeoutMs ?? 3000)
  let outcomes = await params.store.listOutcomes(params.projectId, COMMAND_TYPE, 200)
  while (outcomes.length < params.expectedMin && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => {
      setTimeout(r, 50)
    })
    // eslint-disable-next-line no-await-in-loop
    outcomes = await params.store.listOutcomes(params.projectId, COMMAND_TYPE, 200)
  }

  return outcomes
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

export async function createSmokeContext(opts: {
  llmMode?: 'real' | 'stub'
  projectDir?: string
} = {}): Promise<SmokeContext> {
  const llmMode = opts.llmMode ?? 'stub'

  // Validate llmMode before any side effects (temp dir creation).
  if (llmMode === 'real') {
    throw new Error(
      '--llm real requires a configured LLM provider. ' +
      'Set BYTEROVER_LLM_API_KEY in env. Not yet implemented.',
    )
  }

  const ownsTempDir = opts.projectDir === undefined
  const tempDir = opts.projectDir
    ?? realpathSync(mkdtempSync(join(tmpdir(), 'brv-smoke-harness-')))
  const projectId = 'smoke-harness-test'

  // Only write tsconfig for internally-created temp dirs to avoid
  // clobbering an existing project config in user-provided dirs.
  if (ownsTempDir) {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}')
  }

  _clearPolyglotWarningState()

  const config: ValidatedHarnessConfig = {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
  }
  const logger = new NoOpLogger()

  const keyStorage = new FileKeyStorage({inMemory: true})
  await keyStorage.initialize()
  const store = new HarnessStore(keyStorage, logger)

  const fileSystem = new FileSystemService({
    allowedPaths: [tempDir],
    workingDirectory: tempDir,
  })
  await fileSystem.initialize()

  const builder = new HarnessModuleBuilder(logger)
  const bootstrap = new HarnessBootstrap(store, fileSystem, config, logger)

  const sessionEventBus = new SessionEventBus()
  const recorder = new HarnessOutcomeRecorder(store, sessionEventBus, logger, config)

  const sandboxService = new SandboxService()
  sandboxService.setHarnessConfig(config)
  sandboxService.setEnvironmentContext(makeEnvironmentContext(projectId))
  sandboxService.setHarnessStore(store)
  sandboxService.setHarnessModuleBuilder(builder)
  sandboxService.setFileSystem(fileSystem)
  sandboxService.setHarnessOutcomeRecorder(recorder, logger)

  const agentEventBus = new AgentEventBus()

  // llmMode validated at top of function; only 'stub' reaches here.
  const refiner: IRefinerClient = new FakeRefinerLLM()

  const evaluator = new HarnessEvaluator(store, logger, evalToolsFactory)
  const scenarioCapture = new HarnessScenarioCapture(store, logger)
  const synthesizer = new HarnessSynthesizer(
    store, evaluator, scenarioCapture, refiner,
    agentEventBus, config, logger,
  )

  const bannerLines: string[] = []
  const bannerListener = new HarnessBannerListener({
    eventBus: agentEventBus,
    harnessEnabled: true,
    isTty: true,
    writeLine(line: string) {
      bannerLines.push(line)
    },
  })

  const baselineRunner = new HarnessBaselineRunner(store, logger, evalToolsFactory)

  return {
    agentEventBus,
    bannerLines,
    bannerListener,
    baselineRunner,
    bootstrap,
    config,
    keyStorage,
    ownsTempDir,
    projectId,
    sandboxService,
    state: {refinementEvents: []},
    store,
    synthesizer,
    tempDir,
  }
}

export function cleanupSmokeContext(ctx: SmokeContext): void {
  ctx.sandboxService.cleanup?.()
  ctx.keyStorage.close()
  if (ctx.ownsTempDir) {
    rmSync(ctx.tempDir, {force: true, recursive: true})
  }
}

// ---------------------------------------------------------------------------
// Step functions — exported for unit testing
// ---------------------------------------------------------------------------

/** Step 1: Enable harness -> status shows enabled, no version. */
export async function step01EnableAndStatus(ctx: SmokeContext): Promise<void> {
  const status = await buildStatusReport({
    commandType: COMMAND_TYPE,
    featureConfig: {autoLearn: true, enabled: true},
    projectId: ctx.projectId,
    store: ctx.store,
  })

  assert(status.enabled, 'expected enabled=true')
  assert(status.currentVersionId === null, 'expected no current version')
}

/** Step 2: Bootstrap + 3 curate calls -> v1 created, outcomes recorded. */
export async function step02BootstrapAndCurate(ctx: SmokeContext): Promise<void> {
  await ctx.bootstrap.bootstrapIfNeeded(ctx.projectId, COMMAND_TYPE, ctx.tempDir)

  const v1 = await ctx.store.getLatest(ctx.projectId, COMMAND_TYPE)
  assert(v1 !== undefined, 'bootstrap must create v1')
  assert(v1.version === 1, `expected version=1, got ${v1.version}`)
  assert(v1.projectType === 'typescript', `expected projectType=typescript, got ${v1.projectType}`)
  ctx.state.v1 = v1

  const loadV1 = await ctx.sandboxService.loadHarness(SESSION_ID, ctx.projectId, COMMAND_TYPE)
  assert(loadV1.loaded, 'v1 must load successfully')

  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    const exec = await ctx.sandboxService.executeCode(
      `typeof harness !== 'undefined' && typeof harness.curate === 'function'`,
      SESSION_ID,
      {commandType: COMMAND_TYPE, taskDescription: `smoke-curate-${i}`},
    )
    assert(exec.returnValue === true, `curate exec ${i}: expected returnValue=true`)
  }

  const outcomes = await waitForOutcomes({expectedMin: 3, projectId: ctx.projectId, store: ctx.store})
  assert(outcomes.length >= 3, `expected >=3 outcomes, got ${outcomes.length}`)
}

/** Step 3: Inspect v1 -> pass-through body visible. */
export async function step03InspectV1(ctx: SmokeContext): Promise<void> {
  assert(ctx.state.v1 !== undefined, 'v1 must exist (step 2 prerequisite)')
  const report = toInspectReport(ctx.state.v1)
  assert(report.code.includes('ctx.tools.curate(ctx.env)'), 'v1 code must contain pass-through body')
  assert(report.version === 1, `expected version=1, got ${report.version}`)
  assert(report.projectType === 'typescript', 'expected projectType=typescript')
}

/** Step 4: Seed 20+ outcomes + refinement -> v2 created. */
export async function step04RefinementToV2(ctx: SmokeContext): Promise<void> {
  // 47 more outcomes (3 from step 2 = 50 total). 0.8 failure ratio
  // passes the synthesizer's minimum-signal check.
  await seedOutcomes({count: 47, projectId: ctx.projectId, store: ctx.store})
  await seedScenarios(ctx.store, ctx.projectId, 10)

  ctx.agentEventBus.on('harness:refinement-completed', (payload) => {
    ctx.state.refinementEvents.push(payload as unknown as Record<string, unknown>)
  })

  const result = await ctx.synthesizer.refineIfNeeded(ctx.projectId, COMMAND_TYPE)
  assert(result !== undefined, 'synthesizer must produce a refinement result')
  assert(result.accepted, 'refinement must be accepted')

  const versions = await ctx.store.listVersions(ctx.projectId, COMMAND_TYPE)
  assert(versions.length === 2, `expected 2 versions, got ${versions.length}`)
  const v2 = versions.find((v) => v.version === 2)
  assert(v2 !== undefined, 'v2 must exist')
  assert(v2.code.includes('ctx.env.customConfig == null'), 'v2 must contain null guard')
  ctx.state.v2 = v2

  assert(ctx.state.refinementEvents.length === 1, 'expected 1 refinement event')
  assert(ctx.state.refinementEvents[0].accepted === true, 'event must be accepted')
}

/** Step 5: Banner prints "harness updated: v1 -> v2". */
export async function step05SessionBanner(ctx: SmokeContext): Promise<void> {
  ctx.bannerListener.onSessionEnd()

  assert(ctx.bannerLines.length === 1, `expected 1 banner line, got ${ctx.bannerLines.length}`)
  const banner = ctx.bannerLines[0]
  assert(typeof banner === 'string', 'banner must be a string')
  assert(/harness updated: v1 → v2 \(H: /.test(banner), `banner must match pattern, got: ${banner}`)
}

/** Step 6: Diff v1 v2 -> unified diff shows refined logic. */
export async function step06DiffV1V2(ctx: SmokeContext): Promise<void> {
  assert(ctx.state.v1 !== undefined, 'v1 must exist')
  assert(ctx.state.v2 !== undefined, 'v2 must exist')
  const report = buildDiffReport(ctx.state.v1, ctx.state.v2)
  assert(report.unifiedDiff.includes('-'), 'diff must contain deletions')
  assert(report.unifiedDiff.includes('+'), 'diff must contain additions')
  assert(report.unifiedDiff.includes('ctx.env.customConfig == null'), 'diff must show null guard')
  assert(report.lineAdds > 0, 'must have line additions')
}

/** Step 7: Curate with v2 injected. */
export async function step07CurateWithV2(ctx: SmokeContext): Promise<void> {
  const session2 = 'smoke-sess-2'
  const loadV2 = await ctx.sandboxService.loadHarness(session2, ctx.projectId, COMMAND_TYPE)
  assert(loadV2.loaded, 'v2 must load')
  assert(loadV2.version.version === 2, `expected version=2, got ${loadV2.version.version}`)

  const exec = await ctx.sandboxService.executeCode(
    `typeof harness !== 'undefined' && typeof harness.curate === 'function'`,
    session2,
    {commandType: COMMAND_TYPE, taskDescription: 'smoke-curate-v2'},
  )
  assert(exec.returnValue === true, 'v2 curate must return true')
}

/** Step 8: Feedback bad -> synthetics inserted. */
export async function step08FeedbackBad(ctx: SmokeContext): Promise<void> {
  // Seed 15 query outcomes (all success) so feedback has a target.
  await seedOutcomes({commandType: 'query', count: 15, failureRatio: 0, projectId: ctx.projectId, store: ctx.store})

  const result = await attachFeedbackToStore(
    ctx.store,
    ctx.projectId,
    'query',
    'bad',
    {autoLearn: true, enabled: true},
  )

  assert(result.verdict === 'bad', `expected verdict=bad, got ${result.verdict}`)
  assert(result.syntheticCount === 3, `expected 3 synthetics, got ${result.syntheticCount}`)
}

/** Step 9: H drops after bad feedback synthetics. */
export async function step09HeuristicDrops(ctx: SmokeContext): Promise<void> {
  // Compute H from real outcomes vs all outcomes (including synthetics).
  const allOutcomes = await ctx.store.listOutcomes(ctx.projectId, 'query', 200)
  const realOutcomes = allOutcomes.filter((o) => !o.id.includes(SYNTHETIC_DELIMITER))
  const hBefore = computeHeuristic(realOutcomes, Date.now())
  const hAfter = computeHeuristic(allOutcomes, Date.now())

  assert(hBefore !== null, 'H-before must be computable')
  assert(hAfter !== null, 'H-after must be computable')
  assert(hAfter < hBefore, `H must drop: before=${hBefore}, after=${hAfter}`)
}

/** Step 10: Pin v1 -> loadHarness returns v1. */
export async function step10PinV1(ctx: SmokeContext): Promise<void> {
  assert(ctx.state.v1 !== undefined, 'v1 must exist')
  await ctx.store.setPin({
    commandType: COMMAND_TYPE,
    pinnedAt: Date.now(),
    pinnedVersionId: ctx.state.v1.id,
    projectId: ctx.projectId,
  })

  const session3 = 'smoke-sess-3'
  const loadPinned = await ctx.sandboxService.loadHarness(session3, ctx.projectId, COMMAND_TYPE)
  assert(loadPinned.loaded, 'pinned version must load')
  assert(loadPinned.version.id === ctx.state.v1.id, 'loaded version must be v1')
  assert(loadPinned.version.version === 1, 'loaded version number must be 1')
}

/** Step 11: Baseline -> dual-arm replay. */
export async function step11Baseline(ctx: SmokeContext): Promise<void> {
  // Remove pin so baseline uses latest (v2) for harness arm.
  await ctx.store.deletePin(ctx.projectId, COMMAND_TYPE)

  const baseline = await ctx.baselineRunner.runBaseline({
    commandType: COMMAND_TYPE,
    count: 10,
    projectId: ctx.projectId,
  })

  assert(baseline.scenarioCount > 0, `expected >0 scenarios, got ${baseline.scenarioCount}`)
  assert(typeof baseline.harnessSuccessRate === 'number', 'harnessSuccessRate must be a number')
  assert(typeof baseline.rawSuccessRate === 'number', 'rawSuccessRate must be a number')
  assert(typeof baseline.delta === 'number', 'delta must be a number')
  assert(baseline.perScenario.length === baseline.scenarioCount, 'perScenario length must match')
  assert(baseline.delta >= 0, `delta should be >=0, got ${baseline.delta}`)
}

/** Step 12: Disable harness -> no injection. */
export async function step12DisableHarness(ctx: SmokeContext): Promise<void> {
  const status = await buildStatusReport({
    commandType: COMMAND_TYPE,
    featureConfig: {autoLearn: true, enabled: false},
    projectId: ctx.projectId,
    store: ctx.store,
  })
  assert(status.enabled === false, 'status must show disabled')

  ctx.sandboxService.setHarnessConfig({...ctx.config, enabled: false})
  const session4 = 'smoke-sess-4'
  const loadDisabled = await ctx.sandboxService.loadHarness(session4, ctx.projectId, COMMAND_TYPE)
  assert(!loadDisabled.loaded, 'loadHarness must return loaded=false when disabled')
}

// ---------------------------------------------------------------------------
// Step registry
// ---------------------------------------------------------------------------

export type StepFn = (ctx: SmokeContext) => Promise<void>

export const STEPS: ReadonlyArray<{fn: StepFn; label: string}> = [
  {fn: step01EnableAndStatus, label: 'Enable harness, run status'},
  {fn: step02BootstrapAndCurate, label: 'Bootstrap + 3 curate calls'},
  {fn: step03InspectV1, label: 'Inspect v1'},
  {fn: step04RefinementToV2, label: 'Seed outcomes + refinement -> v2'},
  {fn: step05SessionBanner, label: 'Session-end banner'},
  {fn: step06DiffV1V2, label: 'Diff v1 v2'},
  {fn: step07CurateWithV2, label: 'Curate with v2'},
  {fn: step08FeedbackBad, label: 'Feedback bad -> synthetics'},
  {fn: step09HeuristicDrops, label: 'H drops after bad feedback'},
  {fn: step10PinV1, label: 'Pin v1 -> loadHarness returns v1'},
  {fn: step11Baseline, label: 'Baseline dual-arm replay'},
  {fn: step12DisableHarness, label: 'Disable harness'},
]

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface StepResult {
  readonly details?: string
  readonly label: string
  readonly passed: boolean
  readonly stepNumber: number
}

export async function runSmoke(ctx: SmokeContext): Promise<StepResult[]> {
  const results: StepResult[] = []

  for (const [i, {fn, label}] of STEPS.entries()) {
    const stepNumber = i + 1
    try {
      // eslint-disable-next-line no-await-in-loop
      await fn(ctx)
      results.push({label, passed: true, stepNumber})
      console.log(`  PASS  Step ${stepNumber}: ${label}`)
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      results.push({details, label, passed: false, stepNumber})
      console.log(`  FAIL  Step ${stepNumber}: ${label} — ${details}`)
      // Sequential dependency: if step N fails, steps N+1..12 can't run.
      break
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Main — only runs when invoked directly
// ---------------------------------------------------------------------------

const isDirectExecution = process.argv[1]?.endsWith('/scripts/harness-smoke.ts')
  || process.argv[1]?.endsWith('/scripts/harness-smoke.js')

if (isDirectExecution) {
  const args = process.argv.slice(2)
  let projectDir: string | undefined
  let llmMode: 'real' | 'stub' = 'stub'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && i + 1 < args.length) {
      projectDir = args[++i]
    } else if (args[i] === '--llm' && i + 1 < args.length) {
      const mode = args[++i]
      if (mode !== 'stub' && mode !== 'real') {
        console.error(`Invalid --llm value: ${mode}. Use 'stub' or 'real'.`)
        // eslint-disable-next-line n/no-process-exit
        process.exit(1)
      }

      llmMode = mode
    }
  }

  console.log('AutoHarness V2 — Smoke Test')
  console.log(`LLM mode: ${llmMode}`)
  console.log('')

  const ctx = await createSmokeContext({llmMode, projectDir})

  try {
    const results = await runSmoke(ctx)
    console.log('')

    const passed = results.filter((r) => r.passed).length
    const total = STEPS.length
    console.log(`${passed}/${total} steps passed`)

    if (passed < total) {
      const firstFail = results.find((r) => !r.passed)
      // eslint-disable-next-line n/no-process-exit
      process.exit(firstFail?.stepNumber ?? 1)
    }
  } finally {
    cleanupSmokeContext(ctx)
  }
}
