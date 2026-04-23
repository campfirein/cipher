/**
 * AutoHarness V2 — Full-lifecycle integration test (v1.0 ship gate).
 *
 * Exercises the entire feature from bootstrap to refined-injection in
 * one continuous flow. Every integration seam is touched:
 *
 *   1. Cold start — bootstrap → v1 lands in store
 *   2. Outcome accumulation — 15 success+delegated → H = 0.5
 *   3. Mode selection — ensureHarnessReady → Mode A (assisted)
 *   4. Refinement trigger — critic → refiner → evaluator → v2
 *   5. Refined injection — delegated=false outcomes → Mode B (filter)
 *
 * Single `it` block — the 5 steps depend on accumulated state.
 * Splitting would produce repetitive setup.
 *
 * Real everything: HarnessStore, HarnessBootstrap, HarnessModuleBuilder,
 * HarnessScenarioCapture, HarnessSynthesizer, HarnessEvaluator,
 * SandboxService, HarnessOutcomeRecorder, SystemPromptManager,
 * AgentLLMService. Only IRefinerClient is stubbed (deterministic
 * refinement keeps heuristic trajectory assertions non-flaky).
 *
 * Budget: < 30s.
 */

import {expect} from 'chai'
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {EnvironmentContext} from '../../../../src/agent/core/domain/environment/types.js'
import type {
  CodeExecOutcome,
  EvaluationScenario,
  HarnessContextTools,
  HarnessMode,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'
import type {IToolProvider} from '../../../../src/agent/core/interfaces/i-tool-provider.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {HarnessToolsFactory} from '../../../../src/agent/infra/harness/harness-evaluator.js'
import type {IRefinerClient} from '../../../../src/agent/infra/harness/harness-refiner-client.js'

import {computeHeuristic} from '../../../../src/agent/core/domain/harness/heuristic.js'
import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {AgentEventBus, SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {FileSystemService} from '../../../../src/agent/infra/file-system/file-system-service.js'
import {_clearPolyglotWarningState} from '../../../../src/agent/infra/harness/detect-and-pick-template.js'
import {HarnessEvaluator} from '../../../../src/agent/infra/harness/harness-evaluator.js'
import {
  HarnessBootstrap,
  HarnessModuleBuilder,
  HarnessOutcomeRecorder,
  HarnessScenarioCapture,
  HarnessStore,
  HarnessSynthesizer,
} from '../../../../src/agent/infra/harness/index.js'
import {
  GLOBAL_RATE_LIMITER,
  TEST_ONLY_RESET,
} from '../../../../src/agent/infra/harness/rate-limiter.js'
import {AgentLLMService} from '../../../../src/agent/infra/llm/agent-llm-service.js'
import {SandboxService} from '../../../../src/agent/infra/sandbox/sandbox-service.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'
import {HarnessContributor} from '../../../../src/agent/infra/system-prompt/contributors/harness-contributor.js'
import {SystemPromptManager} from '../../../../src/agent/infra/system-prompt/system-prompt-manager.js'
import {ToolManager} from '../../../../src/agent/infra/tools/tool-manager.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'full-lifecycle-test'
const COMMAND_TYPE = 'curate' as const

/**
 * v2 harness code — returned by FakeRefinerLLM. Adds a null guard so
 * evaluation runs succeed (returns early without calling curate, which
 * would throw in dryRun). Contains 'ctx.env.customConfig == null' for
 * structural-change assertions.
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

/**
 * Test-double LLM implementing IRefinerClient. Returns hand-crafted
 * responses to keep the test deterministic and reviewer-eyeballable.
 */
class FakeRefinerLLM implements IRefinerClient {
  criticCallCount = 0
  readonly modelId: string
  refinerCallCount = 0

  constructor() {
    this.modelId = 'test-model-capable'
  }

  async completeCritic(_prompt: string): Promise<string> {
    this.criticCallCount++
    return CRITIC_ANALYSIS
  }

  async completeRefiner(_prompt: string): Promise<string> {
    this.refinerCallCount++
    return V2_CODE
  }
}

/**
 * Seed N outcomes into the store. `batchIndex` spaces timestamps:
 * batch 0 is oldest, batch 1 is middle, batch 2+ is most recent.
 * `label` differentiates IDs when multiple seeds share a batchIndex.
 */
async function seedOutcomes(
  store: HarnessStore,
  spec: {
    batchIndex: number
    count: number
    delegated?: boolean
    label?: string
    stderr?: string
    success: boolean
    usedHarness?: boolean
  },
): Promise<void> {
  const now = Date.now()
  const tag = spec.label ?? `batch${spec.batchIndex}`
  // Batch 0: -200s, Batch 1: -100s, Batch 2: 0s (most recent)
  const baseOffset = (2 - spec.batchIndex) * 100_000
  const promises: Promise<void>[] = []
  for (let i = 0; i < spec.count; i++) {
    const outcome: CodeExecOutcome = {
      code: `step ${i}`,
      commandType: COMMAND_TYPE,
      delegated: spec.delegated,
      executionTimeMs: 10,
      id: `o-${tag}-${i}`,
      projectId: PROJECT_ID,
      projectType: 'typescript',
      sessionId: 'seed-session',
      stderr: spec.stderr,
      success: spec.success,
      timestamp: now - baseOffset - (spec.count - 1 - i) * 1000,
      usedHarness: spec.usedHarness ?? false,
    }
    promises.push(store.saveOutcome(outcome))
  }

  await Promise.all(promises)
}

/**
 * Seed evaluation scenarios: half positive, half negative.
 */
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

/** Private-method test access — same pattern as mode-selection.test.ts. */
type EnsureHarnessReadyResult = undefined | {mode: HarnessMode; version: HarnessVersion}
function callEnsureHarnessReady(
  service: AgentLLMService,
  commandType: 'chat' | 'curate' | 'query',
): Promise<EnsureHarnessReadyResult> {
  const internal = service as unknown as {
    ensureHarnessReady: (ct: 'chat' | 'curate' | 'query') => Promise<EnsureHarnessReadyResult>
  }
  return internal.ensureHarnessReady(commandType)
}

/**
 * Create an AgentLLMService wired into the shared component graph.
 * Each call returns a fresh service with its own mode-dedup set,
 * enabling multiple sessions to emit independent mode-selected events.
 */
function createAgentService(opts: {
  harnessBootstrap: HarnessBootstrap
  harnessConfig: ValidatedHarnessConfig
  harnessStore: HarnessStore
  sandboxService: SandboxService
  sessionEventBus: SessionEventBus
  sessionId: string
  systemPromptManager: SystemPromptManager
}): AgentLLMService {
  const mockToolProvider = {
    getAllTools: () => ({}),
    getAvailableMarkers: () => new Set<string>(),
    getToolNames: () => [],
  }
  const toolManager = new ToolManager(mockToolProvider as unknown as IToolProvider)

  const generator: IContentGenerator = {
    generateContent() {
      throw new Error('integration test: content generator must not be invoked')
    },
  } as unknown as IContentGenerator

  return new AgentLLMService(
    opts.sessionId,
    generator,
    {model: 'gemini-2.5-flash'},
    {
      harnessBootstrap: opts.harnessBootstrap,
      harnessConfig: opts.harnessConfig,
      harnessStore: opts.harnessStore,
      sandboxService: opts.sandboxService,
      sessionEventBus: opts.sessionEventBus,
      systemPromptManager: opts.systemPromptManager,
      toolManager,
    },
  )
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AutoHarness V2 — full-lifecycle integration test (ship gate)', function () {
  this.timeout(30_000)

  let tempDir: string
  let sb: SinonSandbox
  let keyStorage: FileKeyStorage
  let sandboxService: SandboxService

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-full-lifecycle-')))
    sb = createSandbox()
    sb.stub(process, 'cwd').returns(PROJECT_ID)
    _clearPolyglotWarningState()
    GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
  })

  afterEach(async () => {
    await sandboxService?.cleanup()
    keyStorage?.close()
    sb.restore()
    rmSync(tempDir, {force: true, recursive: true})
    GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
  })

  it('exercises bootstrap -> accumulation -> mode selection -> refinement -> refined injection', async () => {
    // ═══════════════════════════════════════════════════════════════
    // Wire component graph
    // ═══════════════���══════════════════════════���════════════════════
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}')

    const config = makeHarnessConfig()
    const logger = new NoOpLogger()

    keyStorage = new FileKeyStorage({inMemory: true})
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

    const systemPromptManager = new SystemPromptManager()
    systemPromptManager.registerContributor(new HarnessContributor())

    // Collect events across all phases
    const modeEvents: Array<{heuristic: number; mode: HarnessMode}> = []
    sessionEventBus.on('harness:mode-selected', (payload) => {
      modeEvents.push(payload as {heuristic: number; mode: HarnessMode})
    })

    const refinementEvents: Array<Record<string, unknown>> = []
    agentEventBus.on('harness:refinement-completed', (payload) => {
      refinementEvents.push(payload as unknown as Record<string, unknown>)
    })

    // ═══════════════════════════════════════════════════════════════
    // Step 1: Cold start
    // ═══════════════════════════════════════════════════════════════
    // Bootstrap fires, detects TypeScript project (tsconfig.json),
    // writes v1 template to the store.
    await bootstrap.bootstrapIfNeeded(PROJECT_ID, COMMAND_TYPE, tempDir)

    const v1 = await store.getLatest(PROJECT_ID, COMMAND_TYPE)
    expect(v1, 'bootstrap must write v1').to.not.equal(undefined)
    if (v1 === undefined) throw new Error('unreachable: v1 asserted above')
    expect(v1.version).to.equal(1)
    expect(v1.projectType).to.equal('typescript')
    expect(v1.metadata.projectPatterns).to.include('tsconfig.json')

    // loadHarness sees the newly-written v1
    const loadV1 = await sandboxService.loadHarness('sess-1', PROJECT_ID, COMMAND_TYPE)
    expect(loadV1.loaded).to.equal(true)
    if (!loadV1.loaded) throw new Error('unreachable: loadV1 asserted above')
    expect(loadV1.version.version).to.equal(1)

    // Store state: 1 version, 0 outcomes, 0 scenarios
    const versionsStep1 = await store.listVersions(PROJECT_ID, COMMAND_TYPE)
    expect(versionsStep1).to.have.length(1)

    // ════════════════════════��═════════════════════════════���════════
    // Step 2: Outcome accumulation
    // ═════════════════════════════���═════════════════════════���═══════
    // Seed 15 outcomes: success=true, no stderr, usedHarness=true,
    // delegated=true. All v1 pass-through outcomes.
    //
    // Heuristic math (all outcomes recent, weights ~1.0 each):
    //   successRate    = 15/15 = 1.0
    //   errorRate      = 0/15  = 0
    //   realHarnessRate = 0    (all delegated=true)
    //   H = 0.2*1 + 0.3*(1-0) + 0.5*0 = 0.5
    //
    // 0.5 is in [0.30, 0.6) -> Mode A (assisted).
    await seedOutcomes(store, {
      batchIndex: 0,
      count: 15,
      delegated: true,
      success: true,
      usedHarness: true,
    })

    const outcomesStep2 = await store.listOutcomes(PROJECT_ID, COMMAND_TYPE, 200)
    expect(outcomesStep2).to.have.length(15)

    // Verify the heuristic value before mode selection
    const hStep2 = computeHeuristic(outcomesStep2, Date.now())
    expect(hStep2, 'H after step 2 must be computable (>= 10 outcomes)').to.not.equal(null)
    if (hStep2 === null) throw new Error('unreachable: H asserted above')
    expect(hStep2).to.be.closeTo(0.5, 0.02)

    // ═════════════════════���═════════════════════════════════════════
    // Step 3: Mode selection -> Mode A (assisted)
    // ═══════��═══════════════════════════════════════════════════════
    // Create AgentLLMService (session-1). ensureHarnessReady reads
    // outcomes from store, computes H ~= 0.5, selects Mode A.
    const agentService1 = createAgentService({
      harnessBootstrap: bootstrap,
      harnessConfig: config,
      harnessStore: store,
      sandboxService,
      sessionEventBus,
      sessionId: 'sess-1',
      systemPromptManager,
    })

    const readyStep3 = await callEnsureHarnessReady(agentService1, COMMAND_TYPE)

    expect(readyStep3, 'ensureHarnessReady must return Mode A').to.not.equal(undefined)
    if (readyStep3 === undefined) throw new Error('unreachable: readyStep3 asserted above')
    expect(readyStep3.mode).to.equal('assisted')

    // harness:mode-selected event emitted with correct payload shape
    expect(modeEvents).to.have.length(1)
    expect(modeEvents[0].mode).to.equal('assisted')
    expect(modeEvents[0].heuristic).to.be.closeTo(0.5, 0.02)

    // System prompt contains the assisted-mode block
    const promptStep3 = await systemPromptManager.build({
      commandType: COMMAND_TYPE,
      harnessMode: readyStep3.mode,
      harnessVersion: readyStep3.version,
    })
    expect(promptStep3).to.include('<harness-v2 mode="assisted"')

    // ════════════════��═════════════════════════════════��════════════
    // Step 4: Refinement trigger
    // ══════════════════════���══════════════════════════��═════════════
    // Seed additional failure outcomes so the synthesizer's critic
    // has a dominant failure pattern to analyze. The window (50 most
    // recent) now contains a mix of successes and failures.
    //
    // These outcomes use batchIndex 1 (timestamps between step 2's
    // batch 0 and step 5's batch 2), so they're newer than step 2
    // but will be displaced by step 5's outcomes.
    await seedOutcomes(store, {
      batchIndex: 1,
      count: 35,
      stderr: "TypeError: Cannot read properties of undefined (reading 'x')",
      success: false,
      usedHarness: false,
    })

    // Seed 10 scenarios: 5 positive, 5 negative
    await seedScenarios(store, 10)

    const scenariosStep4 = await store.listScenarios(PROJECT_ID, COMMAND_TYPE)
    expect(scenariosStep4).to.have.length(10)

    // Trigger refinement: critic -> refiner -> evaluator -> accept
    const refinementResult = await synthesizer.refineIfNeeded(PROJECT_ID, COMMAND_TYPE)
    expect(refinementResult, 'refinement must produce a result').to.not.equal(undefined)
    if (refinementResult === undefined) throw new Error('unreachable: refinement asserted above')
    expect(refinementResult.accepted).to.equal(true)
    expect(refinementResult.deltaH).to.be.greaterThan(0.05)
    expect(refinementResult.fromVersionId).to.equal(v1.id)
    expect(refinementResult.toVersionId).to.be.a('string')

    // v2 saved in store with correct parentage
    const versionsStep4 = await store.listVersions(PROJECT_ID, COMMAND_TYPE)
    expect(versionsStep4).to.have.length(2)

    const v2 = versionsStep4.find((v) => v.version === 2)
    expect(v2, 'v2 must exist in store').to.not.equal(undefined)
    if (v2 === undefined) throw new Error('unreachable: v2 asserted above')
    expect(v2.parentId).to.equal(v1.id)
    expect(v2.code).to.include('ctx.env.customConfig == null')

    // harness:refinement-completed event with full payload shape
    expect(refinementEvents).to.have.length(1)
    const refEvent = refinementEvents[0]
    expect(refEvent.accepted).to.equal(true)
    expect(refEvent.commandType).to.equal(COMMAND_TYPE)
    expect(refEvent.projectId).to.equal(PROJECT_ID)
    expect(refEvent.fromVersion).to.equal(1)
    expect(refEvent.toVersion).to.equal(2)
    expect(refEvent.fromHeuristic).to.be.a('number')
    // v2's heuristic must be higher than v1's
    expect(refEvent.toHeuristic).to.be.a('number').and.greaterThan(refEvent.fromHeuristic as number)

    // Critic and refiner both called exactly once
    expect(refiner.criticCallCount).to.equal(1)
    expect(refiner.refinerCallCount).to.equal(1)

    // ═���══════════════════��══════════════════════════════════════════
    // Step 5: Refined injection -> Mode B (filter)
    // ═══════════════════════════════════════════════════════════════
    // Seed 50 new outcomes with recent timestamps (batch 2) to
    // dominate the window. Half have delegated=false to boost
    // realHarnessRate — simulating successful v2 harness execution
    // where the harness handled the operation directly (not
    // pass-through).
    //
    // Heuristic math (batch 2 fills the window of 50):
    //   successRate     = 50/50 = 1.0
    //   errorRate       = 0/50  = 0
    //   25 delegated=false + 25 delegated=true out of 50 usedHarness
    //   realHarnessRate = 25/50 = 0.5
    //   H = 0.2*1 + 0.3*(1-0) + 0.5*0.5 = 0.75
    //
    // 0.75 is in [0.6, 0.85) -> Mode B (filter).
    await seedOutcomes(store, {
      batchIndex: 2,
      count: 25,
      delegated: false,
      label: 'p5-real',
      success: true,
      usedHarness: true,
    })
    await seedOutcomes(store, {
      batchIndex: 2,
      count: 25,
      delegated: true,
      label: 'p5-delegated',
      success: true,
      usedHarness: true,
    })

    // Verify heuristic from the most-recent 50 outcomes
    const allOutcomes = await store.listOutcomes(PROJECT_ID, COMMAND_TYPE, 200)
    const hStep5 = computeHeuristic(allOutcomes, Date.now())
    expect(hStep5, 'H after step 5 seeding must be computable').to.not.equal(null)
    if (hStep5 === null) throw new Error('unreachable: H asserted above')
    // H should be around 0.75 — above Mode B floor (0.6), below Mode C (0.85)
    expect(hStep5).to.be.greaterThanOrEqual(0.6)
    expect(hStep5).to.be.lessThan(0.85)

    // Create a new AgentLLMService (session-2) for fresh mode dedup.
    // Each AgentLLMService instance has its own dedup set — production
    // creates one per session, so this mirrors real lifecycle.
    const agentService2 = createAgentService({
      harnessBootstrap: bootstrap,
      harnessConfig: config,
      harnessStore: store,
      sandboxService,
      sessionEventBus,
      sessionId: 'sess-2',
      systemPromptManager,
    })

    const readyStep5 = await callEnsureHarnessReady(agentService2, COMMAND_TYPE)

    expect(readyStep5, 'ensureHarnessReady must return Mode B').to.not.equal(undefined)
    if (readyStep5 === undefined) throw new Error('unreachable: readyStep5 asserted above')
    expect(readyStep5.mode).to.equal('filter')

    // v2 is now the loaded version (latest in store)
    expect(readyStep5.version.version).to.equal(2)
    expect(readyStep5.version.code).to.include('ctx.env.customConfig == null')

    // Second harness:mode-selected event — mode transitioned to filter
    expect(modeEvents).to.have.length(2)
    expect(modeEvents[1].mode).to.equal('filter')
    expect(modeEvents[1].heuristic).to.be.greaterThanOrEqual(0.6)

    // System prompt now contains the filter-mode block
    const promptStep5 = await systemPromptManager.build({
      commandType: COMMAND_TYPE,
      harnessMode: readyStep5.mode,
      harnessVersion: readyStep5.version,
    })
    expect(promptStep5).to.include('<harness-v2 mode="filter"')

    // Sandbox loads v2 for the new session
    const loadV2 = await sandboxService.loadHarness('sess-2', PROJECT_ID, COMMAND_TYPE)
    expect(loadV2.loaded).to.equal(true)
    if (!loadV2.loaded) throw new Error('unreachable: loadV2 asserted above')
    expect(loadV2.version.version).to.equal(2)
    expect(loadV2.version.code).to.include('ctx.env.customConfig == null')

    // ═══════════════════════════════════════════════════════════════
    // Final assertions: heuristic trajectory across all phases
    // ════════���═════════════════════════════════════════���════════════
    // Step 2: H ~= 0.5 (all success, all delegated)  -> Mode A
    // Step 5: H ~= 0.75 (all success, half non-delegated) -> Mode B
    // The trajectory shows H climbing as delegated=false outcomes
    // accumulate — this is the core AutoHarness V2 value proposition:
    // real harness usage (not pass-through) drives mode graduation.
    expect(hStep5).to.be.greaterThan(hStep2)

    // Final store state: 2 versions, v2 linked to v1
    const finalVersions = await store.listVersions(PROJECT_ID, COMMAND_TYPE)
    expect(finalVersions).to.have.length(2)
    const finalV2 = finalVersions.find((v) => v.version === 2)
    expect(finalV2).to.not.equal(undefined)
    if (finalV2 === undefined) throw new Error('unreachable: finalV2 asserted above')
    expect(finalV2.parentId).to.equal(v1.id)

    // Event summary: 2 mode-selected + 1 refinement-completed
    expect(modeEvents).to.have.length(2)
    expect(refinementEvents).to.have.length(1)
  })
})
