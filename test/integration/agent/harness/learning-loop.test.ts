/**
 * AutoHarness V2 — Learning-loop integration test (Phase 6 ship gate).
 *
 * Exercises the full Critic → Refiner → Evaluator pipeline end to end
 * with real components and a test-double LLM that produces deterministic
 * refiner output.
 *
 * Four scenarios:
 *   1. Successful refinement — dominant failure pattern → v2 accepted
 *   2. Weak-model skip — blocklisted model → no refinement
 *   3. Syntax-invalid refiner output → clean rejection, no crash
 *   4. Session-end trigger idempotence — fires exactly once
 */

import {expect} from 'chai'
import sinon from 'sinon'

import type {
  CodeExecOutcome,
  EvaluationScenario,
  HarnessContextTools,
  HarnessMeta,
  HarnessVersion,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {HarnessToolsFactory} from '../../../../src/agent/infra/harness/harness-evaluator.js'
import type {IRefinerClient} from '../../../../src/agent/infra/harness/harness-refiner-client.js'

import {AgentEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessEvaluator} from '../../../../src/agent/infra/harness/harness-evaluator.js'
import {HarnessScenarioCapture} from '../../../../src/agent/infra/harness/harness-scenario-capture.js'
import {HarnessStore} from '../../../../src/agent/infra/harness/harness-store.js'
import {HarnessSynthesizer} from '../../../../src/agent/infra/harness/harness-synthesizer.js'
import {FileKeyStorage} from '../../../../src/agent/infra/storage/file-key-storage.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'test-project'
const COMMAND_TYPE = 'curate' as const

const V1_META: HarnessMeta = {
  capabilities: ['curate'],
  commandType: 'curate',
  projectPatterns: ['**/*.ts', '**/*.tsx', 'tsconfig.json'],
  version: 1,
}

/**
 * v1 harness code — the bootstrap template for TypeScript/curate.
 * Calls ctx.tools.curate() which throws in dryRun evaluation. This
 * doesn't matter because v1 is never evaluated — its quality comes
 * from the seeded outcomes.
 */
const V1_CODE = `
exports.meta = function meta() {
  return {
    capabilities: ['curate'],
    commandType: 'curate',
    projectPatterns: ['**/*.ts', '**/*.tsx', 'tsconfig.json'],
    version: 1,
  }
}

exports.curate = async function curate(ctx) {
  return ctx.tools.curate(ctx.env)
}
`.trimStart()

/**
 * v2 harness code — the "fixed" version returned by FakeRefinerLLM.
 * Adds a null guard so evaluation runs succeed (returns early without
 * calling curate, which would throw in dryRun).
 *
 * Substring 'ctx.env.customConfig == null' is used in assertions to
 * verify the refiner's structural change landed.
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

/** Canned critic analysis returned by FakeRefinerLLM. */
const CRITIC_ANALYSIS = [
  'Failure pattern: reads undefined x.',
  'Root cause: missing null check on ctx.env.customConfig.',
  'Suggested change: add if (ctx.env.customConfig == null) return',
].join('\n')

/** Syntactically-invalid JS for Scenario 3. */
const BROKEN_JS = 'const { x = broken JS'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHarnessConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

function makeLogger(): ILogger & {calls: Record<string, Array<{context?: Record<string, unknown>; message: string}>>} {
  const calls: Record<string, Array<{context?: Record<string, unknown>; message: string}>> = {
    debug: [],
    error: [],
    info: [],
    warn: [],
  }
  return {
    calls,
    debug(message: string, context?: Record<string, unknown>) { calls.debug.push({context, message}) },
    error(message: string, context?: Record<string, unknown>) { calls.error.push({context, message}) },
    info(message: string, context?: Record<string, unknown>) { calls.info.push({context, message}) },
    warn(message: string, context?: Record<string, unknown>) { calls.warn.push({context, message}) },
    withSource() { return this },
  } as unknown as ILogger & {calls: Record<string, Array<{context?: Record<string, unknown>; message: string}>>}
}

function makeV1(): HarnessVersion {
  return {
    code: V1_CODE,
    commandType: COMMAND_TYPE,
    createdAt: Date.now() - 60_000,
    heuristic: 0.3,
    id: 'v1-id',
    metadata: V1_META,
    projectId: PROJECT_ID,
    projectType: 'typescript',
    version: 1,
  }
}

/**
 * Seed 50 outcomes: 40 failures with stderr (dominant failure pattern)
 * and 10 successes. This produces a low baseline H (~0.10).
 */
async function seedOutcomes(store: HarnessStore): Promise<void> {
  const now = Date.now()
  for (let i = 0; i < 50; i++) {
    const isFailing = i < 40
    const outcome: CodeExecOutcome = {
      code: 'tools.search("x")',
      commandType: COMMAND_TYPE,
      executionTimeMs: 42,
      id: `outcome-${i}`,
      projectId: PROJECT_ID,
      projectType: 'typescript',
      sessionId: 'seed-session',
      stderr: isFailing ? "TypeError: Cannot read properties of undefined (reading 'x')" : undefined,
      success: !isFailing,
      timestamp: now - 50_000 + i * 1000,
      usedHarness: false,
    }
    // eslint-disable-next-line no-await-in-loop
    await store.saveOutcome(outcome)
  }
}

/**
 * Seed 10 evaluation scenarios: 5 positive ("Succeeds without errors")
 * and 5 negative ("Throws TypeError on undefined property access").
 */
async function seedScenarios(store: HarnessStore): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const isPositive = i < 5
    const scenario: EvaluationScenario = {
      code: `harness.curate(ctx)`,
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
 * responses to keep the test reviewer-eyeballable.
 */
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
 * Wire the full synthesizer stack with real components.
 */
function createSynthesizerStack(opts: {
  config?: ValidatedHarnessConfig
  logger: ReturnType<typeof makeLogger>
  refinerClient: IRefinerClient
  store: HarnessStore
}): {eventBus: AgentEventBus; scenarioCapture: HarnessScenarioCapture; synthesizer: HarnessSynthesizer} {
  const {config, logger, refinerClient, store} = opts
  const eventBus = new AgentEventBus()

  const evaluator = new HarnessEvaluator(store, logger, evalToolsFactory)
  const scenarioCapture = new HarnessScenarioCapture(store, logger)

  const synthesizer = new HarnessSynthesizer(
    store,
    evaluator,
    scenarioCapture,
    refinerClient,
    eventBus,
    config ?? makeHarnessConfig(),
    logger,
  )

  return {eventBus, scenarioCapture, synthesizer}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Learning-loop integration test', function () {
  // Generous budget: Scenario 1 runs 10 scenarios × 10 runs = 100 sandbox
  // executions. On a loaded CI runner this can take a few seconds.
  this.timeout(10_000)

  let keyStorage: FileKeyStorage
  let store: HarnessStore
  let logger: ReturnType<typeof makeLogger>

  beforeEach(async () => {
    keyStorage = new FileKeyStorage({inMemory: true})
    await keyStorage.initialize()
    logger = makeLogger()
    store = new HarnessStore(keyStorage, logger)
  })

  afterEach(() => {
    sinon.restore()
    keyStorage.close()
  })

  // ── Scenario 1: successful refinement ─────────────────────────────────

  describe('Scenario 1: successful refinement', () => {
    it('accepts v2 with deltaH > 0.05, saves new version, emits accepted event', async () => {
      // Setup: v1 + seeded outcomes + scenarios
      const v1 = makeV1()
      await store.saveVersion(v1)
      await seedOutcomes(store)
      await seedScenarios(store)

      const refiner = new FakeRefinerLLM()
      const {eventBus, synthesizer} = createSynthesizerStack({
        logger,
        refinerClient: refiner,
        store,
      })

      // Capture events
      const events: Array<Record<string, unknown>> = []
      eventBus.on('harness:refinement-completed', (payload) => {
        events.push(payload as unknown as Record<string, unknown>)
      })

      // Run the pipeline
      const result = await synthesizer.refineIfNeeded(PROJECT_ID, COMMAND_TYPE)

      // ── Assertions ──

      // Result accepted with significant improvement
      expect(result).to.not.equal(undefined)
      expect(result?.accepted).to.equal(true)
      expect(result?.deltaH).to.be.greaterThan(0.05)
      expect(result?.fromVersionId).to.equal(v1.id)
      expect(result?.toVersionId).to.be.a('string')

      // Event emitted
      expect(events).to.have.length(1)
      expect(events[0].accepted).to.equal(true)
      expect(events[0].commandType).to.equal(COMMAND_TYPE)
      expect(events[0].projectId).to.equal(PROJECT_ID)
      expect(events[0].fromVersion).to.equal(1)
      expect(events[0].toVersion).to.equal(2)

      // v2 saved with correct parentage
      const versions = await store.listVersions(PROJECT_ID, COMMAND_TYPE)
      expect(versions).to.have.length(2)

      const v2 = versions.find((v) => v.version === 2)
      expect(v2).to.not.equal(undefined)
      expect(v2?.parentId).to.equal(v1.id)

      // v2 code contains the refiner's structural change
      expect(v2?.code).to.include('ctx.env.customConfig == null')

      // Critic and refiner were both called exactly once
      expect(refiner.criticCallCount).to.equal(1)
      expect(refiner.refinerCallCount).to.equal(1)
    })
  })

  // ── Scenario 2: weak-model skip ──────────────────────────────────────

  describe('Scenario 2: weak-model skip', () => {
    it('skips refinement for blocklisted model, logs warning, no new version', async () => {
      const v1 = makeV1()
      await store.saveVersion(v1)
      await seedOutcomes(store)
      await seedScenarios(store)

      // Blocklisted model + no refinementModel override
      const refiner = new FakeRefinerLLM({modelId: 'llama-3.1-8b-instruct'})
      const {synthesizer} = createSynthesizerStack({
        config: makeHarnessConfig({refinementModel: undefined}),
        logger,
        refinerClient: refiner,
        store,
      })

      const result = await synthesizer.refineIfNeeded(PROJECT_ID, COMMAND_TYPE)

      // Returns undefined — no refinement run
      expect(result).to.equal(undefined)

      // LLM never called
      expect(refiner.criticCallCount).to.equal(0)
      expect(refiner.refinerCallCount).to.equal(0)

      // Warning logged about blocklisted model
      const warnMessages = logger.calls.warn.map((c) => c.message)
      expect(warnMessages.some((m) => m.toLowerCase().includes('blocklist')
        || m.toLowerCase().includes('skip'))).to.equal(true)

      // No new version saved
      const versions = await store.listVersions(PROJECT_ID, COMMAND_TYPE)
      expect(versions).to.have.length(1)
    })
  })

  // ── Scenario 3: syntactically-invalid refiner output ─────────────────

  describe('Scenario 3: syntactically-invalid refiner output', () => {
    it('rejects gracefully, emits rejected event, no new version', async () => {
      const v1 = makeV1()
      await store.saveVersion(v1)
      await seedOutcomes(store)
      await seedScenarios(store)

      const refiner = new FakeRefinerLLM({refinerResponse: BROKEN_JS})
      const {eventBus, synthesizer} = createSynthesizerStack({
        logger,
        refinerClient: refiner,
        store,
      })

      const events: Array<Record<string, unknown>> = []
      eventBus.on('harness:refinement-completed', (payload) => {
        events.push(payload as unknown as Record<string, unknown>)
      })

      const result = await synthesizer.refineIfNeeded(PROJECT_ID, COMMAND_TYPE)

      // Rejected
      expect(result).to.not.equal(undefined)
      expect(result?.accepted).to.equal(false)
      expect(result?.reason).to.be.a('string')

      // Event emitted with accepted: false and a meaningful reason
      expect(events).to.have.length(1)
      expect(events[0].accepted).to.equal(false)
      expect(events[0].reason).to.be.a('string')
      expect((events[0].reason as string).length).to.be.greaterThan(0)

      // No new version saved
      const versions = await store.listVersions(PROJECT_ID, COMMAND_TYPE)
      expect(versions).to.have.length(1)

      // Critic was called (analysis happened before refiner)
      expect(refiner.criticCallCount).to.equal(1)
      // Refiner was called (it returned broken JS)
      expect(refiner.refinerCallCount).to.equal(1)
    })
  })

  // ── Scenario 4: session-end trigger idempotence ──────────────────────

  describe('Scenario 4: session-end trigger idempotence', () => {
    it('fires refineIfNeeded exactly once when session-end observed twice', async () => {
      // Use a stub synthesizer to spy on refineIfNeeded calls.
      // The idempotence guarantee lives in SessionManager's endedSessions
      // dedup set — we need real SessionManager wiring.
      const {SessionManager} = await import('../../../../src/agent/infra/session/session-manager.js')
      const {SessionEventBus} = await import('../../../../src/agent/infra/events/event-emitter.js')
      const {HarnessOutcomeRecorder} = await import('../../../../src/agent/infra/harness/harness-outcome-recorder.js')

      const recorderEventBus = new SessionEventBus()
      const recorder = new HarnessOutcomeRecorder(store, recorderEventBus, logger, makeHarnessConfig())

      // Seed per-session state so the trigger has commandTypes to iterate
      await recorder.record({
        code: 'tools.search("x")',
        commandType: COMMAND_TYPE,
        executionTimeMs: 10,
        harnessVersionId: undefined,
        projectId: PROJECT_ID,
        projectType: 'typescript',
        result: {curateResults: undefined, executionTime: 10, locals: {}, stderr: '', stdout: '2'},
        sessionId: 'sess-1',
      })

      // Stub synthesizer — spy on refineIfNeeded
      const refineStub = sinon.stub().resolves()
      const synthesizerStub = {
        cleanup: sinon.stub(),
        refineIfNeeded: refineStub,
      }

      const sharedServices = {
        harnessConfig: makeHarnessConfig(),
        harnessOutcomeRecorder: recorder,
        harnessSynthesizer: synthesizerStub,
      }

      const sm = new SessionManager(
        sharedServices as never,
        {apiBaseUrl: '', projectId: '', sessionKey: '', spaceId: '', teamId: ''},
        {model: 'test-model'},
      )

      // Inject a stub session
      const stubSession = {
        dispose: sinon.stub(),
        getLLMService: () => ({
          getContextManager: () => ({flush: sinon.stub().resolves()}),
        }),
      }
      ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('sess-1', stubSession)

      // First end → trigger fires
      await sm.endSession('sess-1')

      // Re-inject session for second call
      ;(sm as unknown as {sessions: Map<string, unknown>}).sessions.set('sess-1', {
        dispose: sinon.stub(),
        getLLMService: () => ({
          getContextManager: () => ({flush: sinon.stub().resolves()}),
        }),
      })

      // Second end → dedup prevents second trigger
      await sm.endSession('sess-1')

      // Allow fire-and-forget promises to settle
      await Promise.resolve()

      // refineIfNeeded called exactly once
      expect(refineStub.callCount).to.equal(1)

      // No thrown errors on second call
      sm.dispose()
    })
  })
})
