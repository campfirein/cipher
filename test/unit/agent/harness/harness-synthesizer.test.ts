/**
 * AutoHarness V2 — HarnessSynthesizer tests.
 *
 * Validates the orchestration logic: single-flight per-pair gate,
 * weak-model skip, Critic->Refiner->Evaluator pipeline, markdown-fence
 * fallback, accept/reject paths, and concurrent-pair parallelism.
 *
 * Uses stubbed Evaluator, RefinerClient, and store — the real
 * integration path is exercised in the learning-loop integration test.
 */

import {expect} from 'chai'
import {randomUUID} from 'node:crypto'
import sinon, {type SinonSandbox, type SinonStub} from 'sinon'

import type {
  CodeExecOutcome,
  HarnessVersion,
  ValidatedEvaluationScenario,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../src/agent/core/interfaces/i-harness-store.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {EvaluationResult, HarnessEvaluator} from '../../../../src/agent/infra/harness/harness-evaluator.js'
import type {IRefinerClient} from '../../../../src/agent/infra/harness/harness-refiner-client.js'
import type {HarnessScenarioCapture} from '../../../../src/agent/infra/harness/harness-scenario-capture.js'

import {HarnessStoreError} from '../../../../src/agent/core/domain/errors/harness-store-error.js'
import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {AgentEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessSynthesizer} from '../../../../src/agent/infra/harness/harness-synthesizer.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeParentVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  return {
    code: 'exports.meta = () => ({capabilities:["curate"],commandType:"curate",projectPatterns:["**/*.ts"],version:1}); exports.curate = async (ctx) => {};',
    commandType: 'curate',
    createdAt: Date.now(),
    heuristic: 0.5,
    id: `v-${randomUUID().slice(0, 8)}`,
    metadata: {capabilities: ['curate'], commandType: 'curate', projectPatterns: ['**/*.ts'], version: 1},
    projectId: 'proj-1',
    projectType: 'typescript',
    version: 1,
    ...overrides,
  }
}

function makeOutcomes(count: number): CodeExecOutcome[] {
  return Array.from({length: count}, (_, i) => ({
    code: `code-${i}`,
    commandType: 'curate',
    executionTimeMs: 100,
    id: `outcome-${i}`,
    projectId: 'proj-1',
    projectType: 'typescript' as const,
    sessionId: 'session-1',
    stderr: i % 2 === 1 ? 'TypeError: something' : undefined,
    success: i % 2 === 0,
    timestamp: Date.now() - i * 1000,
    usedHarness: true,
  }))
}

function makeScenarios(count: number): ValidatedEvaluationScenario[] {
  return Array.from({length: count}, (_, i) => ({
    code: `scenario-code-${i}`,
    commandType: 'curate' as const,
    createdAt: Date.now() - i * 1000,
    expectedBehavior: i < Math.floor(count / 2) ? 'Succeeds without errors' : 'Returns error without corrupting state',
    id: `scenario-${i}`,
    projectId: 'proj-1',
    projectType: 'typescript' as const,
    taskDescription: `Task ${i}`,
  }))
}

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

function makeAcceptedResult(deltaH = 0.1): EvaluationResult {
  return {
    accepted: true,
    baselineHeuristic: 0.5,
    candidateHeuristic: 0.5 + deltaH,
    deltaH,
    details: [],
  }
}

function makeRejectedResult(deltaH = 0.03): EvaluationResult {
  return {
    accepted: false,
    baselineHeuristic: 0.5,
    candidateHeuristic: 0.5 + deltaH,
    deltaH,
    details: [],
  }
}

function makeCandidateLoadFailedResult(): EvaluationResult {
  return {
    accepted: false,
    baselineHeuristic: 0.5,
    candidateHeuristic: 0,
    deltaH: -0.5,
    details: [],
  }
}

/** Guard that narrows result and throws with a clear message on miss. */
function assertDefined<T>(value: T | undefined, label: string): asserts value is T {
  if (value === undefined) throw new Error(`expected ${label} to be defined`)
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StubSet {
  completeCritic: SinonStub
  completeRefiner: SinonStub
  config: ValidatedHarnessConfig
  evaluate: SinonStub
  eventBus: AgentEventBus
  getLatest: SinonStub
  listOutcomes: SinonStub
  listScenarios: SinonStub
  logger: ILogger
  refinerClient: IRefinerClient
  saveVersion: SinonStub
  store: IHarnessStore
}

function makeStubs(sb: SinonSandbox, configOverrides?: Partial<ValidatedHarnessConfig>): StubSet {
  const getLatest = sb.stub()
  const listOutcomes = sb.stub()
  const listScenarios = sb.stub()
  const saveVersion = sb.stub()

  const store = {
    deleteOutcomes: sb.stub(),
    deleteScenario: sb.stub(),
    getLatest,
    getVersion: sb.stub(),
    listOutcomes,
    listScenarios,
    listVersions: sb.stub(),
    pruneOldVersions: sb.stub(),
    recordFeedback: sb.stub(),
    saveOutcome: sb.stub(),
    saveScenario: sb.stub(),
    saveVersion,
  } as unknown as IHarnessStore

  const completeCritic = sb.stub()
  const completeRefiner = sb.stub()
  const refinerClient: IRefinerClient = {
    completeCritic,
    completeRefiner,
    modelId: 'claude-sonnet-4-20250514',
  }

  const evaluate = sb.stub()
  const eventBus = new AgentEventBus()
  const config = makeConfig(configOverrides)

  return {
    completeCritic,
    completeRefiner,
    config,
    evaluate,
    eventBus,
    getLatest,
    listOutcomes,
    listScenarios,
    logger: new NoOpLogger(),
    refinerClient,
    saveVersion,
    store,
  }
}

function makeSynthesizer(stubs: StubSet): HarnessSynthesizer {
  const evaluator = {evaluate: stubs.evaluate} as unknown as HarnessEvaluator
  const scenarioCapture = {} as unknown as HarnessScenarioCapture
  return new HarnessSynthesizer(
    stubs.store,
    evaluator,
    scenarioCapture,
    stubs.refinerClient,
    stubs.eventBus,
    stubs.config,
    stubs.logger,
  )
}

/** Wire stubs for a standard happy-path refinement (Critic + Refiner + Evaluate). */
function wireHappyPath(stubs: StubSet, parent: HarnessVersion, evalResult: EvaluationResult): void {
  stubs.getLatest.resolves(parent)
  stubs.listOutcomes.resolves(makeOutcomes(50))
  stubs.listScenarios.resolves(makeScenarios(10))
  stubs.completeCritic.resolves('Failure pattern: null pointer. Root cause: missing check.')
  stubs.completeRefiner.resolves('exports.meta = () => ({capabilities:["curate"],commandType:"curate",projectPatterns:["**/*.ts"],version:2}); exports.curate = async (ctx) => { if (!ctx) return; };')
  stubs.evaluate.resolves(evalResult)
  stubs.saveVersion.resolves()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessSynthesizer', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = sinon.createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  // Test 1: Pair has no parent version -> no refinement
  it('returns undefined when pair has no parent version', async () => {
    const stubs = makeStubs(sb)
    stubs.getLatest.resolves()
    const synth = makeSynthesizer(stubs)

    const result = await synth.refineIfNeeded('proj-1', 'curate')

    expect(result).to.equal(undefined)
    expect(stubs.completeCritic.callCount).to.equal(0)
    expect(stubs.completeRefiner.callCount).to.equal(0)
  })

  // Test 2: 100 parallel refineIfNeeded on same pair -> only one runs
  it('single-flights concurrent calls on the same pair (log-and-drop)', async () => {
    const stubs = makeStubs(sb)
    const parent = makeParentVersion()
    wireHappyPath(stubs, parent, makeAcceptedResult())

    const synth = makeSynthesizer(stubs)

    const promises = Array.from({length: 100}, () => synth.refineIfNeeded('proj-1', 'curate'))
    const results = await Promise.all(promises)

    const ran = results.filter((r): r is NonNullable<typeof r> => r !== undefined)
    expect(ran).to.have.lengthOf(1)
    expect(stubs.completeCritic.callCount).to.equal(1)
    expect(stubs.completeRefiner.callCount).to.equal(1)
  })

  // Test 3: Weak-model skip
  it('skips refinement when runtime model is blocklisted and no refinementModel override', async () => {
    const stubs = makeStubs(sb)
    stubs.refinerClient = {
      completeCritic: stubs.completeCritic,
      completeRefiner: stubs.completeRefiner,
      modelId: 'llama-3.1-8b-instruct',
    }
    const synth = makeSynthesizer(stubs)

    const result = await synth.refineIfNeeded('proj-1', 'curate')

    expect(result).to.equal(undefined)
    expect(stubs.completeCritic.callCount).to.equal(0)
    expect(stubs.completeRefiner.callCount).to.equal(0)
    expect(stubs.getLatest.callCount).to.equal(0)
  })

  // Test 4: Happy path — accepted
  it('accepts candidate when delta H exceeds threshold', async () => {
    const stubs = makeStubs(sb)
    const parent = makeParentVersion()
    wireHappyPath(stubs, parent, makeAcceptedResult(0.1))

    const eventPayloads: unknown[] = []
    stubs.eventBus.on('harness:refinement-completed', (payload) => eventPayloads.push(payload))

    const synth = makeSynthesizer(stubs)
    const result = await synth.refineIfNeeded('proj-1', 'curate')

    assertDefined(result, 'result')
    expect(result.accepted).to.equal(true)
    expect(result.deltaH).to.equal(0.1)
    expect(result.fromVersionId).to.equal(parent.id)
    expect(result.toVersionId).to.be.a('string')

    // saveVersion called with version = parent.version + 1
    expect(stubs.saveVersion.callCount).to.equal(1)
    const savedVersion = stubs.saveVersion.firstCall.args[0] as HarnessVersion
    expect(savedVersion.version).to.equal(parent.version + 1)
    expect(savedVersion.parentId).to.equal(parent.id)

    // Event emitted
    expect(eventPayloads).to.have.lengthOf(1)
    const event = eventPayloads[0] as {accepted: true; toVersion: number}
    expect(event.accepted).to.equal(true)
    expect(event.toVersion).to.equal(parent.version + 1)
  })

  // Test 5: Markdown-fence fallback
  it('strips leading/trailing markdown fences from refiner output', async () => {
    const stubs = makeStubs(sb)
    const parent = makeParentVersion()
    stubs.getLatest.resolves(parent)
    stubs.listOutcomes.resolves(makeOutcomes(50))
    stubs.listScenarios.resolves(makeScenarios(10))
    stubs.completeCritic.resolves('Analysis here')
    stubs.completeRefiner.resolves('```javascript\nexports.meta = () => ({capabilities:["curate"],commandType:"curate",projectPatterns:["**/*.ts"],version:2}); exports.curate = async (ctx) => {};\n```')
    stubs.evaluate.resolves(makeAcceptedResult())
    stubs.saveVersion.resolves()

    const synth = makeSynthesizer(stubs)
    await synth.refineIfNeeded('proj-1', 'curate')

    expect(stubs.evaluate.callCount).to.equal(1)
    const candidateCode = stubs.evaluate.firstCall.args[0] as string
    expect(candidateCode).to.not.include('```')
    expect(candidateCode).to.include('exports.meta')
  })

  // Test 6: Syntactically-invalid refiner output -> evaluator rejects
  it('rejects when evaluator returns candidate load failed', async () => {
    const stubs = makeStubs(sb)
    const parent = makeParentVersion()
    wireHappyPath(stubs, parent, makeCandidateLoadFailedResult())
    stubs.completeRefiner.resolves('const { x = broken JS')

    const eventPayloads: unknown[] = []
    stubs.eventBus.on('harness:refinement-completed', (payload) => eventPayloads.push(payload))

    const synth = makeSynthesizer(stubs)
    const result = await synth.refineIfNeeded('proj-1', 'curate')

    assertDefined(result, 'result')
    expect(result.accepted).to.equal(false)
    expect(result.reason).to.be.a('string')

    expect(stubs.saveVersion.callCount).to.equal(0)

    expect(eventPayloads).to.have.lengthOf(1)
    const event = eventPayloads[0] as {accepted: false; reason: string}
    expect(event.accepted).to.equal(false)
    expect(event.reason).to.be.a('string')
  })

  // Test 7: delta H below threshold -> rejected
  it('rejects when delta H is below acceptance threshold', async () => {
    const stubs = makeStubs(sb)
    const parent = makeParentVersion()
    wireHappyPath(stubs, parent, makeRejectedResult(0.03))

    const eventPayloads: unknown[] = []
    stubs.eventBus.on('harness:refinement-completed', (payload) => eventPayloads.push(payload))

    const synth = makeSynthesizer(stubs)
    const result = await synth.refineIfNeeded('proj-1', 'curate')

    assertDefined(result, 'result')
    expect(result.accepted).to.equal(false)
    expect(result.reason).to.include('0.03')

    expect(stubs.saveVersion.callCount).to.equal(0)

    expect(eventPayloads).to.have.lengthOf(1)
    const event = eventPayloads[0] as {accepted: false; reason: string}
    expect(event.accepted).to.equal(false)
  })

  // Test 8: Concurrent refinements on DIFFERENT pairs -> both run
  it('allows concurrent refinements on different pairs', async () => {
    const stubs = makeStubs(sb)

    const parentCurate = makeParentVersion({commandType: 'curate', projectId: 'proj-1'})
    const parentQuery = makeParentVersion({commandType: 'query', projectId: 'proj-1'})

    stubs.getLatest.withArgs('proj-1', 'curate').resolves(parentCurate)
    stubs.getLatest.withArgs('proj-1', 'query').resolves(parentQuery)
    stubs.listOutcomes.resolves(makeOutcomes(50))
    stubs.listScenarios.resolves(makeScenarios(10))
    stubs.completeCritic.resolves('Analysis')
    stubs.completeRefiner.resolves('exports.meta = () => ({capabilities:["curate"],commandType:"curate",projectPatterns:["**/*.ts"],version:2}); exports.curate = async (ctx) => {};')
    stubs.evaluate.resolves(makeAcceptedResult())
    stubs.saveVersion.resolves()

    const synth = makeSynthesizer(stubs)

    const [resultCurate, resultQuery] = await Promise.all([
      synth.refineIfNeeded('proj-1', 'curate'),
      synth.refineIfNeeded('proj-1', 'query'),
    ])

    assertDefined(resultCurate, 'resultCurate')
    assertDefined(resultQuery, 'resultQuery')
    expect(resultCurate.accepted).to.equal(true)
    expect(resultQuery.accepted).to.equal(true)

    expect(stubs.completeCritic.callCount).to.equal(2)
    expect(stubs.completeRefiner.callCount).to.equal(2)
  })

  // Test 9: Skip when baseline H >= 0.85 and all scenarios passing
  it('skips refinement when baseline H is high and all scenarios are passing', async () => {
    const stubs = makeStubs(sb)
    const parent = makeParentVersion({heuristic: 0.9})
    stubs.getLatest.resolves(parent)

    const highOutcomes = Array.from({length: 50}, (_, i) => ({
      code: `code-${i}`,
      commandType: 'curate',
      delegated: false,
      executionTimeMs: 100,
      id: `outcome-${i}`,
      projectId: 'proj-1',
      projectType: 'typescript' as const,
      sessionId: 'session-1',
      success: true,
      timestamp: Date.now() - i * 1000,
      usedHarness: true,
    }))
    stubs.listOutcomes.resolves(highOutcomes)

    const passingScenarios = Array.from({length: 5}, (_, i) => ({
      code: `scenario-code-${i}`,
      commandType: 'curate' as const,
      createdAt: Date.now() - i * 1000,
      expectedBehavior: 'Succeeds without errors',
      id: `scenario-${i}`,
      projectId: 'proj-1',
      projectType: 'typescript' as const,
      taskDescription: `Task ${i}`,
    }))
    stubs.listScenarios.resolves(passingScenarios)

    const synth = makeSynthesizer(stubs)
    const result = await synth.refineIfNeeded('proj-1', 'curate')

    expect(result).to.equal(undefined)
    expect(stubs.completeCritic.callCount).to.equal(0)
    expect(stubs.completeRefiner.callCount).to.equal(0)
  })

  // Test 10: VERSION_CONFLICT on concurrent cross-instance race
  it('treats VERSION_CONFLICT as lost race and emits rejected event', async () => {
    const stubs = makeStubs(sb)
    const parent = makeParentVersion()
    wireHappyPath(stubs, parent, makeAcceptedResult())
    stubs.saveVersion.rejects(
      HarnessStoreError.versionConflict('proj-1', 'curate', {version: 2}),
    )

    const eventPayloads: unknown[] = []
    stubs.eventBus.on('harness:refinement-completed', (payload) => eventPayloads.push(payload))

    const synth = makeSynthesizer(stubs)
    const result = await synth.refineIfNeeded('proj-1', 'curate')

    assertDefined(result, 'result')
    expect(result.accepted).to.equal(false)
    expect(result.reason).to.include('lost race')

    expect(eventPayloads).to.have.lengthOf(1)
    const event = eventPayloads[0] as {accepted: false; reason: string}
    expect(event.accepted).to.equal(false)
    expect(event.reason).to.include('lost race')
  })
})
