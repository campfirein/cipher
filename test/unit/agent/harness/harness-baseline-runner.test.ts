import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  HarnessContextTools,
  HarnessVersion,
  ValidatedEvaluationScenario,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../src/agent/core/interfaces/i-harness-store.js'

import {NoOpLogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import {
  BASELINE_MAX_COUNT,
  BASELINE_MIN_SCENARIOS,
  HarnessBaselineRunner,
  HarnessBaselineRunnerError,
} from '../../../../src/agent/infra/harness/harness-baseline-runner.js'

// ─── Helpers ─────────────────────────────────────────────────────────────

const PROJECT_ID = 'baseline-test'

function makeVersion(overrides: Partial<HarnessVersion> = {}): HarnessVersion {
  const passThroughCode = `
    exports.meta = function() {
      return {
        capabilities: ['curate'],
        commandType: 'curate',
        projectPatterns: ['**/*'],
        version: 1,
      }
    }
    exports.curate = async function(ctx) { return ctx.tools.curate([]) }
  `
  return {
    code: passThroughCode,
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.3,
    id: 'v-baseline-test',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: ['**/*'],
      version: 1,
    },
    projectId: PROJECT_ID,
    projectType: 'generic',
    version: 1,
    ...overrides,
  }
}

function makeScenario(id: string): ValidatedEvaluationScenario {
  return {
    code: 'test code',
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    expectedBehavior: 'ok',
    id,
    projectId: PROJECT_ID,
    projectType: 'generic',
    taskDescription: 'test task',
  }
}

function makeStoreStub(sb: SinonSandbox): {
  readonly getLatest: SinonStub
  readonly listScenarios: SinonStub
  readonly store: IHarnessStore
} {
  const getLatest = sb.stub()
  const listScenarios = sb.stub()
  const store = {
    deleteOutcome: sb.stub(),
    deleteOutcomes: sb.stub(),
    deleteScenario: sb.stub(),
    getLatest,
    getVersion: sb.stub(),
    listOutcomes: sb.stub(),
    listScenarios,
    listVersions: sb.stub(),
    pruneOldVersions: sb.stub(),
    recordFeedback: sb.stub(),
    saveOutcome: sb.stub(),
    saveScenario: sb.stub(),
    saveVersion: sb.stub(),
  } satisfies IHarnessStore

  return {getLatest, listScenarios, store}
}

/**
 * Build a tools factory whose `curate` rejects/resolves per-arm.
 * Discriminates arms by a side-channel counter: each factory call
 * alternates. Tests use this to control per-arm outcomes.
 *
 * IMPLEMENTATION COUPLING: this helper assumes `runBaseline` invokes
 * the RAW arm before the HARNESS arm within each scenario (odd call =
 * raw, even = harness). If that order is ever reversed, arm
 * assertions invert silently. A more resilient scheme would tag the
 * arm via `ctx.env` and discriminate on the tag; kept simple here
 * because the single `runBaseline` caller is serial and deliberate.
 */
function makeTwoArmToolsFactory(
  sb: SinonSandbox,
  spec: {readonly harness: () => void; readonly raw: () => void},
): () => HarnessContextTools {
  // Call pattern: in `runBaseline`, for EACH scenario, raw arm is
  // built first (first curate call), then harness arm (second).
  // Factory is invoked once per single-scenario execution, so even
  // calls are raw and odd calls are harness — track via counter.
  let call = 0
  return () => {
    call++
    const isRawArm = call % 2 === 1 // 1st, 3rd, 5th... are raw
    const curate = sb.stub().callsFake(() => {
      if (isRawArm) return spec.raw()
      return spec.harness()
    })
    const readFile = sb.stub().resolves()
    return {curate, readFile} as unknown as HarnessContextTools
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('HarnessBaselineRunner', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  it('1. throws COUNT_OUT_OF_RANGE when count is 0', async () => {
    const {store} = makeStoreStub(sb)
    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), () =>
      ({curate: sb.stub().resolves(), readFile: sb.stub().resolves()}) as unknown as HarnessContextTools,
    )

    let caught: unknown
    try {
      await runner.runBaseline({commandType: 'curate', count: 0, projectId: PROJECT_ID})
    } catch (error) {
      caught = error
    }

    expect(caught).to.be.instanceOf(HarnessBaselineRunnerError)
    expect((caught as HarnessBaselineRunnerError).code).to.equal('COUNT_OUT_OF_RANGE')
  })

  it('2. throws COUNT_OUT_OF_RANGE when count exceeds BASELINE_MAX_COUNT', async () => {
    const {store} = makeStoreStub(sb)
    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), () =>
      ({curate: sb.stub(), readFile: sb.stub()}) as unknown as HarnessContextTools,
    )

    let caught: unknown
    try {
      await runner.runBaseline({
        commandType: 'curate',
        count: BASELINE_MAX_COUNT + 1,
        projectId: PROJECT_ID,
      })
    } catch (error) {
      caught = error
    }

    expect((caught as HarnessBaselineRunnerError).code).to.equal('COUNT_OUT_OF_RANGE')
  })

  it('3. throws UNSUPPORTED_COMMAND_TYPE for query / chat (v1.0 curate-only)', async () => {
    const {store} = makeStoreStub(sb)
    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), () =>
      ({curate: sb.stub(), readFile: sb.stub()}) as unknown as HarnessContextTools,
    )

    for (const cmd of ['query', 'chat'] as const) {
      let caught: unknown
      try {
        // eslint-disable-next-line no-await-in-loop
        await runner.runBaseline({commandType: cmd, count: 10, projectId: PROJECT_ID})
      } catch (error) {
        caught = error
      }

      expect(
        (caught as HarnessBaselineRunnerError).code,
        `mismatch for commandType=${cmd}`,
      ).to.equal('UNSUPPORTED_COMMAND_TYPE')
    }
  })

  it('4. throws INSUFFICIENT_SCENARIOS when < 3 scenarios exist', async () => {
    const {getLatest, listScenarios, store} = makeStoreStub(sb)
    listScenarios.resolves([makeScenario('s1'), makeScenario('s2')])
    getLatest.resolves(makeVersion())
    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), () =>
      ({curate: sb.stub(), readFile: sb.stub()}) as unknown as HarnessContextTools,
    )

    let caught: unknown
    try {
      await runner.runBaseline({commandType: 'curate', count: 10, projectId: PROJECT_ID})
    } catch (error) {
      caught = error
    }

    const err = caught as HarnessBaselineRunnerError
    expect(err.code).to.equal('INSUFFICIENT_SCENARIOS')
    expect(err.details.found).to.equal(2)
    expect(err.details.required).to.equal(BASELINE_MIN_SCENARIOS)
  })

  it('4b. INSUFFICIENT_SCENARIOS reflects STORE coverage, not the sliced window', async () => {
    // Store has plenty (10); caller passes --count=2. Error should report
    // the requested window as the bad input, not claim missing data.
    const {getLatest, listScenarios, store} = makeStoreStub(sb)
    listScenarios.resolves(Array.from({length: 10}, (_, i) => makeScenario(`s${i}`)))
    getLatest.resolves(makeVersion())
    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), () =>
      ({curate: sb.stub(), readFile: sb.stub()}) as unknown as HarnessContextTools,
    )

    let caught: unknown
    try {
      await runner.runBaseline({commandType: 'curate', count: 2, projectId: PROJECT_ID})
    } catch (error) {
      caught = error
    }

    // With the fix, 10 stored ≥ 3, so guard does NOT fire — the run proceeds
    // and completes on the 2-scenario slice (count itself is valid: [1, 50]).
    expect(caught).to.equal(undefined)
  })

  it('5. throws NO_CURRENT_VERSION when the pair has no stored version', async () => {
    const {getLatest, listScenarios, store} = makeStoreStub(sb)
    listScenarios.resolves([makeScenario('s1'), makeScenario('s2'), makeScenario('s3')])
    getLatest.resolves()
    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), () =>
      ({curate: sb.stub(), readFile: sb.stub()}) as unknown as HarnessContextTools,
    )

    let caught: unknown
    try {
      await runner.runBaseline({commandType: 'curate', count: 10, projectId: PROJECT_ID})
    } catch (error) {
      caught = error
    }

    expect((caught as HarnessBaselineRunnerError).code).to.equal('NO_CURRENT_VERSION')
  })

  it('6. happy path: raw fails every scenario, harness succeeds → delta = 100%', async () => {
    const {getLatest, listScenarios, store} = makeStoreStub(sb)
    const scenarios = [
      makeScenario('s1'),
      makeScenario('s2'),
      makeScenario('s3'),
      makeScenario('s4'),
    ]
    listScenarios.resolves(scenarios)
    getLatest.resolves(makeVersion())

    const factory = makeTwoArmToolsFactory(sb, {
      harness: () => Promise.resolve(),
      raw() {
        throw new Error('raw arm failure')
      },
    })

    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), factory)
    const report = await runner.runBaseline({
      commandType: 'curate',
      count: 10,
      projectId: PROJECT_ID,
    })

    expect(report.scenarioCount).to.equal(4)
    expect(report.rawSuccessRate).to.equal(0)
    expect(report.harnessSuccessRate).to.equal(1)
    expect(report.delta).to.equal(1)
    for (const result of report.perScenario) {
      expect(result.rawSuccess).to.equal(false)
      expect(result.rawStderr).to.match(/raw arm failure/)
      expect(result.harnessSuccess).to.equal(true)
    }
  })

  it('7. mixed path: both arms pass → delta = 0', async () => {
    const {getLatest, listScenarios, store} = makeStoreStub(sb)
    listScenarios.resolves([makeScenario('s1'), makeScenario('s2'), makeScenario('s3')])
    getLatest.resolves(makeVersion())

    const factory = makeTwoArmToolsFactory(sb, {
      harness: () => Promise.resolve(),
      raw: () => Promise.resolve(),
    })

    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), factory)
    const report = await runner.runBaseline({
      commandType: 'curate',
      count: 3,
      projectId: PROJECT_ID,
    })

    expect(report.rawSuccessRate).to.equal(1)
    expect(report.harnessSuccessRate).to.equal(1)
    expect(report.delta).to.equal(0)
  })

  it('8. count caps the scenarios slice', async () => {
    const {getLatest, listScenarios, store} = makeStoreStub(sb)
    // 10 scenarios in store; ask for 5 → only 5 run.
    const scenarios = Array.from({length: 10}, (_, i) => makeScenario(`s${i}`))
    listScenarios.resolves(scenarios)
    getLatest.resolves(makeVersion())

    const factory = makeTwoArmToolsFactory(sb, {
      harness: () => Promise.resolve(),
      raw: () => Promise.resolve(),
    })

    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), factory)
    const report = await runner.runBaseline({
      commandType: 'curate',
      count: 5,
      projectId: PROJECT_ID,
    })

    expect(report.scenarioCount).to.equal(5)
    expect(report.perScenario.map((r) => r.scenarioId)).to.deep.equal([
      's0',
      's1',
      's2',
      's3',
      's4',
    ])
  })

  it('9. harness run that throws is captured as failure with stderr', async () => {
    const {getLatest, listScenarios, store} = makeStoreStub(sb)
    listScenarios.resolves([makeScenario('s1'), makeScenario('s2'), makeScenario('s3')])
    getLatest.resolves(makeVersion())

    const factory = makeTwoArmToolsFactory(sb, {
      harness() {
        throw new Error('harness cratered')
      },
      raw: () => Promise.resolve(),
    })

    const runner = new HarnessBaselineRunner(store, new NoOpLogger(), factory)
    const report = await runner.runBaseline({
      commandType: 'curate',
      count: 3,
      projectId: PROJECT_ID,
    })

    expect(report.rawSuccessRate).to.equal(1)
    expect(report.harnessSuccessRate).to.equal(0)
    expect(report.delta).to.equal(-1)
    for (const r of report.perScenario) {
      expect(r.harnessStderr).to.match(/cratered/)
    }
  })
})
