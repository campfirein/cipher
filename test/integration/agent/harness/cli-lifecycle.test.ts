/**
 * AutoHarness V2 — CLI lifecycle integration test (ship gate).
 *
 * Walks all 12 steps from execution-plan.md §4.3 end to end in a single
 * continuous `it` block. Every CLI command + session-end banner exercised
 * against real components — only the IRefinerClient is stubbed (canned v2
 * response). Validates the full stack composition from bootstrap to
 * baseline.
 *
 * Step N depends on step N-1's state (v2 needs v1, diff needs both, etc.).
 * If step 3 fails, steps 4-12 don't run — fine because the failure is at
 * step 3 regardless.
 */

import {expect} from 'chai'
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import sinon from 'sinon'

import type {EnvironmentContext} from '../../../../src/agent/core/domain/environment/types.js'
import type {
  CodeExecOutcome,
  EvaluationScenario,
  HarnessContextTools,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {HarnessToolsFactory} from '../../../../src/agent/infra/harness/harness-evaluator.js'
import type {IRefinerClient} from '../../../../src/agent/infra/harness/harness-refiner-client.js'

import {computeHeuristic} from '../../../../src/agent/core/domain/harness/heuristic.js'
import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {AgentEventBus, SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {FileSystemService} from '../../../../src/agent/infra/file-system/file-system-service.js'
import {_clearPolyglotWarningState} from '../../../../src/agent/infra/harness/detect-and-pick-template.js'
import {HarnessBaselineRunner} from '../../../../src/agent/infra/harness/harness-baseline-runner.js'
import {HarnessEvaluator} from '../../../../src/agent/infra/harness/harness-evaluator.js'
import {
  HarnessBootstrap,
  HarnessModuleBuilder,
  HarnessOutcomeRecorder,
  HarnessScenarioCapture,
  HarnessStore,
  HarnessSynthesizer,
} from '../../../../src/agent/infra/harness/index.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {HarnessBannerListener} from '../../../../src/agent/infra/session/harness-banner-listener.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'
import {buildDiffReport} from '../../../../src/oclif/commands/harness/diff.js'
import {toInspectReport} from '../../../../src/oclif/commands/harness/inspect.js'
import {buildStatusReport} from '../../../../src/oclif/commands/harness/status.js'
import {attachFeedbackToStore} from '../../../../src/oclif/lib/harness-feedback.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'cli-lifecycle-test'
const COMMAND_TYPE = 'curate' as const
const SESSION_ID = 'sess-1'

/**
 * v2 harness code — returned by FakeRefinerLLM. Adds a null guard so
 * evaluation runs succeed (returns early without calling curate, which
 * would throw in dryRun). Contains 'ctx.env.customConfig == null' for
 * diff assertions.
 */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHarnessConfig(overrides?: Partial<ValidatedHarnessConfig>): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
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

/**
 * Evaluation-safe tools factory. Matches production `dryRun: true`
 * behavior: curate throws (blocked writes during eval), readFile
 * returns a stub.
 */
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

/**
 * Seed N outcomes: failures with stderr (dominant failure pattern)
 * and successes. Low H baseline drives the synthesizer to attempt
 * refinement.
 */
async function seedOutcomes(store: HarnessStore, count: number, opts?: {
  commandType?: 'curate' | 'query'
  failureRatio?: number
  startIndex?: number
  usedHarness?: boolean
}): Promise<void> {
  const now = Date.now()
  const commandType = opts?.commandType ?? COMMAND_TYPE
  const failureRatio = opts?.failureRatio ?? 0.8
  const startIndex = opts?.startIndex ?? 0
  const usedHarness = opts?.usedHarness ?? false
  for (let i = 0; i < count; i++) {
    const isFailing = i < Math.floor(count * failureRatio)
    const outcome: CodeExecOutcome = {
      code: 'tools.search("x")',
      commandType,
      executionTimeMs: 42,
      id: `seeded-${commandType}-outcome-${startIndex + i}`,
      projectId: PROJECT_ID,
      projectType: 'typescript',
      sessionId: 'seed-session',
      stderr: isFailing ? "TypeError: Cannot read properties of undefined (reading 'x')" : undefined,
      success: !isFailing,
      timestamp: now - 50_000 + i * 1000,
      usedHarness,
    }
    // eslint-disable-next-line no-await-in-loop
    await store.saveOutcome(outcome)
  }
}

async function seedScenarios(store: HarnessStore, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const isPositive = i < Math.floor(count / 2)
    const scenario: EvaluationScenario = {
      code: 'harness.curate(ctx)',
      commandType: COMMAND_TYPE,
      createdAt: Date.now() - 30_000 + i * 1000,
      expectedBehavior: isPositive
        ? 'Succeeds without errors'
        : 'Throws TypeError on undefined property access',
      id: `scenario-${i}`,
      projectId: PROJECT_ID,
      projectType: 'typescript',
      taskDescription: isPositive ? 'Normal curate operation' : 'Null-pointer failure case',
    }
    // eslint-disable-next-line no-await-in-loop
    await store.saveScenario(scenario)
  }
}

/**
 * Poll the store until the expected outcome count is reached.
 * The recorder writes fire-and-forget so outcomes land async.
 */
async function waitForOutcomes(
  store: HarnessStore,
  expectedMin: number,
  timeoutMs = 3000,
): Promise<CodeExecOutcome[]> {
  const deadline = Date.now() + timeoutMs
  let outcomes = await store.listOutcomes(PROJECT_ID, COMMAND_TYPE, 200)
  while (outcomes.length < expectedMin && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => {
      setTimeout(r, 50)
    })
    // eslint-disable-next-line no-await-in-loop
    outcomes = await store.listOutcomes(PROJECT_ID, COMMAND_TYPE, 200)
  }

  return outcomes
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI lifecycle integration test (ship gate)', function () {
  this.timeout(15_000)

  let tempDir: string
  let keyStorage: FileKeyStorage
  let store: HarnessStore
  let sandboxService: SandboxService

  beforeEach(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-cli-lifecycle-')))
    _clearPolyglotWarningState()
  })

  afterEach(async () => {
    await sandboxService?.cleanup()
    keyStorage?.close()
    sinon.restore()
    rmSync(tempDir, {force: true, recursive: true})
  })

  it('walks all 12 §4.3 smoke steps end-to-end', async () => {
    // ── Wire component graph ──────────────────────────────────────────
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}')

    const config = makeHarnessConfig()
    const logger = new NoOpLogger()

    keyStorage = new FileKeyStorage({inMemory: true})
    await keyStorage.initialize()
    store = new HarnessStore(keyStorage, logger)

    const fileSystem = new FileSystemService({
      allowedPaths: [tempDir],
      workingDirectory: tempDir,
    })
    await fileSystem.initialize()

    const builder = new HarnessModuleBuilder(logger)
    const bootstrap = new HarnessBootstrap(store, fileSystem, config, logger)

    const sessionEventBus = new SessionEventBus()
    const recorder = new HarnessOutcomeRecorder(store, sessionEventBus, logger, config)

    sandboxService = new SandboxService()
    sandboxService.setHarnessConfig(config)
    sandboxService.setEnvironmentContext(makeEnvironmentContext(PROJECT_ID))
    sandboxService.setHarnessStore(store)
    sandboxService.setHarnessModuleBuilder(builder)
    sandboxService.setFileSystem(fileSystem)
    sandboxService.setHarnessOutcomeRecorder(recorder, logger)

    const agentEventBus = new AgentEventBus()
    const refiner = new FakeRefinerLLM()
    const evaluator = new HarnessEvaluator(store, logger, evalToolsFactory)
    const scenarioCapture = new HarnessScenarioCapture(store, logger)
    const synthesizer = new HarnessSynthesizer(
      store, evaluator, scenarioCapture, refiner,
      agentEventBus, config, logger,
    )

    const bannerWriteLine = sinon.stub()
    const bannerListener = new HarnessBannerListener({
      eventBus: agentEventBus,
      harnessEnabled: true,
      isTty: true,
      writeLine: bannerWriteLine,
    })

    // ── Step 1: Enable harness, run status ────────────────────────────
    // Config is already enabled. buildStatusReport with no store version
    // should show enabled: true, currentVersionId: null.
    const statusBefore = await buildStatusReport({
      commandType: COMMAND_TYPE,
      featureConfig: {autoLearn: true, enabled: true},
      projectId: PROJECT_ID,
      store,
    })

    expect(statusBefore.enabled).to.equal(true)
    expect(statusBefore.currentVersionId).to.equal(null)

    // ── Step 2: Run curate 3 times ────────────────────────────────────
    // Bootstrap creates v1. Then 3 executeCode calls record outcomes.
    await bootstrap.bootstrapIfNeeded(PROJECT_ID, COMMAND_TYPE, tempDir)

    const v1 = await store.getLatest(PROJECT_ID, COMMAND_TYPE)
    expect(v1, 'bootstrap must write v1').to.not.equal(undefined)
    if (v1 === undefined) throw new Error('unreachable: v1 asserted above')
    expect(v1.version).to.equal(1)
    expect(v1.projectType).to.equal('typescript')

    // Load harness for session, then execute 3 curate calls
    const loadV1 = await sandboxService.loadHarness(SESSION_ID, PROJECT_ID, COMMAND_TYPE)
    expect(loadV1.loaded).to.equal(true)

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await sandboxService.executeCode(
        `typeof harness !== 'undefined' && typeof harness.curate === 'function'`,
        SESSION_ID,
        {commandType: COMMAND_TYPE, taskDescription: `curate-${i}`},
      )
    }

    // Wait for fire-and-forget outcomes to land
    const step2Outcomes = await waitForOutcomes(store, 3)
    expect(step2Outcomes.length).to.be.greaterThanOrEqual(3)

    // ── Step 3: Inspect latest ────────────────────────────────────────
    // v1 is the pass-through template; inspect report shows its body.
    const inspectReport = toInspectReport(v1)
    expect(inspectReport.code).to.include('ctx.tools.curate(ctx.env)')
    expect(inspectReport.version).to.equal(1)
    expect(inspectReport.projectType).to.equal('typescript')

    // ── Step 4: Seed 20 outcomes + refinement → v2 ────────────────────
    // Seed additional outcomes (dominant failures) for the synthesizer's
    // critic analysis and evaluation. Seed scenarios for the evaluator.
    await seedOutcomes(store, 47)
    await seedScenarios(store, 10)

    const refinementEvents: Array<Record<string, unknown>> = []
    agentEventBus.on('harness:refinement-completed', (payload) => {
      refinementEvents.push(payload as unknown as Record<string, unknown>)
    })

    const result = await synthesizer.refineIfNeeded(PROJECT_ID, COMMAND_TYPE)
    expect(result).to.not.equal(undefined)
    if (result === undefined) throw new Error('unreachable: result asserted above')
    expect(result.accepted).to.equal(true)

    // v2 written
    const versions = await store.listVersions(PROJECT_ID, COMMAND_TYPE)
    expect(versions.length).to.equal(2)
    const v2 = versions.find((v) => v.version === 2)
    expect(v2, 'v2 must exist').to.not.equal(undefined)
    if (v2 === undefined) throw new Error('unreachable: v2 asserted above')
    expect(v2.code).to.include('ctx.env.customConfig == null')

    // harness:refinement-completed event fired
    expect(refinementEvents).to.have.length(1)
    expect(refinementEvents[0].accepted).to.equal(true)
    expect(refinementEvents[0].fromVersion).to.equal(1)
    expect(refinementEvents[0].toVersion).to.equal(2)

    // ── Step 5: Banner listener captured the event ────────────────────
    // The listener buffers the accepted refinement; onSessionEnd prints.
    bannerListener.onSessionEnd()

    expect(bannerWriteLine.callCount).to.equal(1)
    const bannerOutput = bannerWriteLine.firstCall.args[0]
    if (typeof bannerOutput !== 'string') throw new Error('expected banner output to be a string')
    expect(bannerOutput).to.match(/harness updated: v1 → v2 \(H: /)

    // ── Step 6: Diff v1 v2 ────────────────────────────────────────────
    const diffReport = buildDiffReport(v1, v2)
    expect(diffReport.unifiedDiff).to.include('-')
    expect(diffReport.unifiedDiff).to.include('+')
    // v2 added the null guard
    expect(diffReport.unifiedDiff).to.include('ctx.env.customConfig == null')
    expect(diffReport.lineAdds).to.be.greaterThan(0)

    // ── Step 7: Curate once more with v2 injected ─────────────────────
    // Use a new session so loadHarness re-reads from store (v2 is now latest).
    const SESSION_2 = 'sess-2'
    const loadV2 = await sandboxService.loadHarness(SESSION_2, PROJECT_ID, COMMAND_TYPE)
    expect(loadV2.loaded).to.equal(true)
    if (!loadV2.loaded) throw new Error('unreachable: loadV2 asserted above')
    expect(loadV2.version.version).to.equal(2)

    await sandboxService.executeCode(
      `typeof harness !== 'undefined' && typeof harness.curate === 'function'`,
      SESSION_2,
      {commandType: COMMAND_TYPE, taskDescription: 'curate-with-v2'},
    )

    // ── Step 8: Query --feedback bad → synthetics inserted ─────────────
    // Seed 15 query outcomes (all success, no stderr) so H is computable
    // for the query commandType. Then attach bad feedback to the most
    // recent query outcome.
    await seedOutcomes(store, 15, {commandType: 'query', failureRatio: 0})

    const queryOutcomesBefore = await store.listOutcomes(PROJECT_ID, 'query', 200)
    const hQueryBefore = computeHeuristic(queryOutcomesBefore, Date.now())

    const feedbackResult = await attachFeedbackToStore(
      store,
      PROJECT_ID,
      'query',
      'bad',
      {autoLearn: true, enabled: true},
    )

    expect(feedbackResult.verdict).to.equal('bad')
    expect(feedbackResult.syntheticCount).to.equal(3)

    // Verify synthetics were inserted
    const queryOutcomesAfter = await store.listOutcomes(PROJECT_ID, 'query', 200)
    const syntheticOutcomes = queryOutcomesAfter.filter((o) => o.id.includes('__synthetic_'))
    expect(syntheticOutcomes.length).to.be.greaterThanOrEqual(3)

    // Most-recent query outcome has userFeedback = 'bad'
    const targetOutcome = queryOutcomesAfter.find((o) => o.id === feedbackResult.outcomeId)
    expect(targetOutcome).to.not.equal(undefined)
    if (targetOutcome === undefined) throw new Error('unreachable: targetOutcome asserted above')
    expect(targetOutcome.userFeedback).to.equal('bad')

    // ── Step 9: H drops with weighted rows ────────────────────────────
    // The 15 query outcomes are all success with no stderr, giving a
    // baseline H. The 3 bad synthetics (success:false) lower successRate
    // without adding stderr, so H drops reliably.
    const hQueryAfter = computeHeuristic(queryOutcomesAfter, Date.now())
    expect(hQueryBefore, 'H-before must be computable').to.not.equal(null)
    expect(hQueryAfter, 'H-after must be computable').to.not.equal(null)
    if (hQueryBefore === null || hQueryAfter === null) {
      throw new Error('unreachable: H assertions above')
    }

    expect(hQueryAfter).to.be.lessThan(hQueryBefore)

    // ── Step 10: Use v1 → pin, loadHarness returns v1 ─────────────────
    await store.setPin({
      commandType: COMMAND_TYPE,
      pinnedAt: Date.now(),
      pinnedVersionId: v1.id,
      projectId: PROJECT_ID,
    })

    const SESSION_3 = 'sess-3'
    const loadPinned = await sandboxService.loadHarness(SESSION_3, PROJECT_ID, COMMAND_TYPE)
    expect(loadPinned.loaded).to.equal(true)
    if (!loadPinned.loaded) throw new Error('unreachable: loadPinned asserted above')
    expect(loadPinned.version.id).to.equal(v1.id)
    expect(loadPinned.version.version).to.equal(1)

    // ── Step 11: Baseline → dual-arm replay ───────────────────────────
    // Delete pin so baseline uses the latest (v2) for the harness arm.
    await store.deletePin(PROJECT_ID, COMMAND_TYPE)

    const baselineRunner = new HarnessBaselineRunner(store, logger, evalToolsFactory)
    const baseline = await baselineRunner.runBaseline({
      commandType: COMMAND_TYPE,
      count: 10,
      projectId: PROJECT_ID,
    })

    expect(baseline.scenarioCount).to.be.greaterThan(0)
    expect(baseline.harnessSuccessRate).to.be.a('number')
    expect(baseline.rawSuccessRate).to.be.a('number')
    expect(baseline.delta).to.be.a('number')
    expect(baseline.perScenario.length).to.equal(baseline.scenarioCount)

    // v2 adds a null guard that prevents the WRITE_BLOCKED_DURING_EVAL
    // throw, so v2 succeeds where v1 also returns early. The delta
    // should be >= 0 (harness at least as good as raw).
    expect(baseline.delta).to.be.greaterThanOrEqual(0)

    // ── Step 12: Disable harness → status shows disabled ──────────────
    const statusDisabled = await buildStatusReport({
      commandType: COMMAND_TYPE,
      featureConfig: {autoLearn: true, enabled: false},
      projectId: PROJECT_ID,
      store,
    })

    expect(statusDisabled.enabled).to.equal(false)

    // Disabled config → loadHarness returns {loaded: false}
    sandboxService.setHarnessConfig(makeHarnessConfig({enabled: false}))
    const SESSION_4 = 'sess-4'
    const loadDisabled = await sandboxService.loadHarness(SESSION_4, PROJECT_ID, COMMAND_TYPE)
    expect(loadDisabled.loaded).to.equal(false)
  })
})
