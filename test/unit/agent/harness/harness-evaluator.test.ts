/**
 * AutoHarness V2 — HarnessEvaluator tests.
 *
 * The evaluator scores a candidate harness by running it against
 * evaluation scenarios and computing mean Δ H vs. the baseline parent
 * version. The 10-run statistical-significance gate prevents accepting
 * a candidate whose improvement was a single-sample noise spike.
 *
 * Tests 1-6 use a real `HarnessModuleBuilder` with stubbed tools and
 * store. Test 7 uses the real sandbox + module-builder pipeline to
 * exercise the full VM execution path.
 */

import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  CodeExecOutcome,
  HarnessContextTools,
  HarnessVersion,
  ValidatedEvaluationScenario,
} from '../../../../src/agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../../src/agent/core/interfaces/i-harness-store.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'

import {HarnessEvaluatorError} from '../../../../src/agent/infra/harness/harness-evaluator-errors.js'
import {HarnessEvaluator} from '../../../../src/agent/infra/harness/harness-evaluator.js'

// ---------------------------------------------------------------------------
// Constants mirrored from evaluator for assertions
// ---------------------------------------------------------------------------
const EVAL_RUNS_PER_SCENARIO = 10
const ACCEPTANCE_DELTA = 0.05

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Valid CommonJS harness that always succeeds (returns without throwing). */
const CANDIDATE_ALWAYS_SUCCEEDS = `
  exports.meta = function meta() {
    return {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    }
  }

  exports.curate = async function curate(ctx) {
    return {applied: 1}
  }
`

/** Valid CommonJS harness that always throws. */
const CANDIDATE_ALWAYS_FAILS = `
  exports.meta = function meta() {
    return {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    }
  }

  exports.curate = async function curate(ctx) {
    throw new Error('intentional failure')
  }
`

/**
 * Valid CommonJS harness that calls ctx.tools.curate — used to verify
 * dryRun enforcement. Under dryRun, this throws WRITE_BLOCKED_DURING_EVAL.
 */
const CANDIDATE_CALLS_CURATE = `
  exports.meta = function meta() {
    return {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    }
  }

  exports.curate = async function curate(ctx) {
    return ctx.tools.curate([], {})
  }
`

/** Valid CommonJS harness that only calls ctx.tools.readFile. */
const CANDIDATE_READS_ONLY = `
  exports.meta = function meta() {
    return {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    }
  }

  exports.curate = async function curate(ctx) {
    const content = await ctx.tools.readFile('/test.ts')
    return {read: true}
  }
`

/** Syntactically broken code — module builder will reject. */
const CANDIDATE_SYNTAX_ERROR = 'const { x = broken JS'

function makeParentVersion(overrides?: Partial<HarnessVersion>): HarnessVersion {
  return {
    code: CANDIDATE_ALWAYS_SUCCEEDS,
    commandType: 'curate',
    createdAt: 1_700_000_000_000,
    heuristic: 0.3,
    id: 'parent-v1',
    metadata: {
      capabilities: ['curate'],
      commandType: 'curate',
      projectPatterns: [],
      version: 1,
    },
    projectId: 'proj-eval',
    projectType: 'typescript',
    version: 1,
    ...overrides,
  }
}

function makeScenario(overrides?: Partial<ValidatedEvaluationScenario>): ValidatedEvaluationScenario {
  return {
    code: 'tools.curate([])',
    commandType: 'curate',
    createdAt: Date.now(),
    expectedBehavior: 'Succeeds without errors',
    id: 'scenario-1',
    projectId: 'proj-eval',
    projectType: 'typescript',
    taskDescription: 'Test scenario',
    ...overrides,
  }
}

/**
 * Build N fake outcomes with an exact success count.
 * All outcomes share the same timestamp to eliminate recency-weighting
 * bias in `computeHeuristic` — makes H deterministic and predictable.
 *
 * H = 0.2·successRate + 0.3·(1−errorRate) + 0.5·realHarnessRate
 * With usedHarness=true, delegated=false, no stderr:
 *   H = 0.2·(successCount/count) + 0.3 + 0.5
 *     = 0.2·(successCount/count) + 0.8
 */
function makeOutcomes(
  count: number,
  successCount: number,
  baseTimestamp: number = Date.now(),
): CodeExecOutcome[] {
  const outcomes: CodeExecOutcome[] = []
  for (let i = 0; i < count; i++) {
    outcomes.push({
      code: 'test',
      commandType: 'curate',
      delegated: false,
      executionTimeMs: 10,
      id: `outcome-${i}`,
      projectId: 'proj-eval',
      projectType: 'typescript',
      sessionId: 'eval-session',
      success: i < successCount,
      timestamp: baseTimestamp,
      usedHarness: true,
    })
  }

  return outcomes
}

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeStoreStub(sb: SinonSandbox): {
  readonly listOutcomes: SinonStub
  readonly store: IHarnessStore
} {
  const listOutcomes = sb.stub()
  const store = {
    deleteOutcome: sb.stub(),
    deleteOutcomes: sb.stub(),
    deletePin: sb.stub().resolves(false),
    deleteScenario: sb.stub(),
    deleteScenarios: sb.stub(),
    deleteVersion: sb.stub(),
    getLatest: sb.stub(),
    getPin: sb.stub(),
    getVersion: sb.stub(),
    listOutcomes,
    listScenarios: sb.stub(),
    listVersions: sb.stub(),
    pruneOldVersions: sb.stub(),
    recordFeedback: sb.stub(),
    saveOutcome: sb.stub(),
    saveScenario: sb.stub(),
    saveVersion: sb.stub(),
    setPin: sb.stub(),
  } satisfies IHarnessStore

  return {listOutcomes, store}
}

function makeLoggerStub(sb: SinonSandbox): ILogger {
  return {
    debug: sb.stub(),
    error: sb.stub(),
    info: sb.stub(),
    warn: sb.stub(),
  }
}

/**
 * Build tools where curate always resolves (no dryRun blocking).
 * Used for tests 1-3 where we want to control success via candidate code.
 */
function makeSuccessTools(): HarnessContextTools {
  return {
    curate: (async () => ({applied: 1})) as unknown as HarnessContextTools['curate'],
    readFile: (async () => ({content: 'test', exists: true, path: '/test.ts'})) as unknown as HarnessContextTools['readFile'],
  }
}

/**
 * Build tools where curate throws WRITE_BLOCKED_DURING_EVAL.
 * Matches the production dryRun behavior.
 */
function makeDryRunTools(): HarnessContextTools {
  return {
    curate: (async () => {
      throw new HarnessEvaluatorError('WRITE_BLOCKED_DURING_EVAL')
    }) as unknown as HarnessContextTools['curate'],
    readFile: (async () => ({content: '', exists: true, path: '/'})) as unknown as HarnessContextTools['readFile'],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessEvaluator — statistical-significance gate', () => {
  let sb: SinonSandbox

  beforeEach(() => {
    sb = createSandbox()
  })

  afterEach(() => {
    sb.restore()
  })

  // -----------------------------------------------------------------------
  // Test 1: Candidate that always succeeds
  // -----------------------------------------------------------------------
  it('always-succeeding candidate → H = 1.0, accepted if baseline < 0.95', async () => {
    const {listOutcomes, store} = makeStoreStub(sb)
    const logger = makeLoggerStub(sb)

    // Baseline: 50 outcomes with 25 successes → H = 0.2*(25/50)+0.8 = 0.9
    listOutcomes.resolves(makeOutcomes(50, 25))

    const evaluator = new HarnessEvaluator(
      store,
      logger,
      () => makeSuccessTools(),
    )

    const parent = makeParentVersion()
    const scenarios = [makeScenario()]

    const result = await evaluator.evaluate(
      CANDIDATE_ALWAYS_SUCCEEDS,
      parent,
      scenarios,
    )

    // Candidate succeeds on all 10 runs → candidateH = 1.0
    expect(result.candidateHeuristic).to.equal(1)
    expect(result.deltaH).to.be.greaterThan(ACCEPTANCE_DELTA)
    expect(result.accepted).to.equal(true)
    expect(result.details).to.have.lengthOf(1)
    expect(result.details[0].runs).to.have.lengthOf(EVAL_RUNS_PER_SCENARIO)
  })

  // -----------------------------------------------------------------------
  // Test 2: Candidate that always fails
  // -----------------------------------------------------------------------
  it('always-failing candidate → H = 0, accepted = false', async () => {
    const {listOutcomes, store} = makeStoreStub(sb)
    const logger = makeLoggerStub(sb)

    // Baseline with moderate H: 25/50 successes → H = 0.9
    listOutcomes.resolves(makeOutcomes(50, 25))

    const evaluator = new HarnessEvaluator(
      store,
      logger,
      () => makeSuccessTools(),
    )

    const parent = makeParentVersion()
    const scenarios = [makeScenario()]

    const result = await evaluator.evaluate(
      CANDIDATE_ALWAYS_FAILS,
      parent,
      scenarios,
    )

    // Candidate fails all 10 runs → candidateH = 0
    expect(result.candidateHeuristic).to.equal(0)
    expect(result.accepted).to.equal(false)
    expect(result.details[0].runs.every((r) => !r.success)).to.equal(true)
  })

  // -----------------------------------------------------------------------
  // Test 3: Mixed 6/10 success
  // -----------------------------------------------------------------------
  it('mixed 6/10 success → H reflects the mean; deterministic', async () => {
    const {listOutcomes, store} = makeStoreStub(sb)
    const logger = makeLoggerStub(sb)

    // Low baseline: 10/50 successes → H = 0.2*(10/50)+0.8 = 0.84
    listOutcomes.resolves(makeOutcomes(50, 10))

    // Candidate succeeds on first 6 calls, fails on next 4.
    // Sinon onCall sequencing is robust under any concurrency model.
    const curateStub = sb.stub()
    for (let i = 0; i < 6; i++) curateStub.onCall(i).resolves({applied: 1})
    for (let i = 6; i < 10; i++) curateStub.onCall(i).rejects(new Error('fail after 6'))

    const evaluator = new HarnessEvaluator(
      store,
      logger,
      () => ({
        curate: curateStub as unknown as HarnessContextTools['curate'],
        readFile: (async () => ({content: '', exists: true, path: '/'})) as unknown as HarnessContextTools['readFile'],
      }),
    )

    // Use a candidate that calls curate — tool behavior controls success/failure
    const parent = makeParentVersion()
    const scenarios = [makeScenario()]

    const result = await evaluator.evaluate(
      CANDIDATE_CALLS_CURATE,
      parent,
      scenarios,
    )

    // 6 successes out of 10 runs
    const successCount = result.details[0].runs.filter((r) => r.success).length
    expect(successCount).to.equal(6)
    expect(result.candidateHeuristic).to.be.greaterThan(0)
    expect(result.candidateHeuristic).to.be.lessThan(1)
  })

  // -----------------------------------------------------------------------
  // Test 4: Stat-significance gate boundary (0.04 / 0.05 / 0.06)
  // -----------------------------------------------------------------------
  describe('acceptance delta boundary', () => {
    it('Δ = 0.04 → rejected', async () => {
      const {listOutcomes, store} = makeStoreStub(sb)
      const logger = makeLoggerStub(sb)

      // candidateH = 1.0 (always succeeds)
      // Need baselineH = 0.96 → sR = (0.96-0.8)/0.2 = 0.8
      // 50 outcomes, 40 successes → sR = 40/50 = 0.8 → H = 0.96
      // Δ = 1.0 - 0.96 = 0.04 → rejected
      listOutcomes.resolves(makeOutcomes(50, 40))

      const evaluator = new HarnessEvaluator(
        store,
        logger,
        () => makeSuccessTools(),
      )

      const result = await evaluator.evaluate(
        CANDIDATE_ALWAYS_SUCCEEDS,
        makeParentVersion(),
        [makeScenario()],
      )

      expect(result.deltaH).to.be.closeTo(0.04, 0.001)
      expect(result.accepted).to.equal(false)
    })

    it('Δ = 0.05 → accepted', async () => {
      const {listOutcomes, store} = makeStoreStub(sb)
      const logger = makeLoggerStub(sb)

      // candidateH = 1.0 (always succeeds)
      // Need baselineH = 0.95 → sR = (0.95-0.8)/0.2 = 0.75
      // 20 outcomes, 15 successes → sR = 15/20 = 0.75 → H = 0.95
      // Δ = 1.0 - 0.95 = 0.05 → accepted (>= threshold)
      listOutcomes.resolves(makeOutcomes(20, 15))

      const evaluator = new HarnessEvaluator(
        store,
        logger,
        () => makeSuccessTools(),
      )

      const result = await evaluator.evaluate(
        CANDIDATE_ALWAYS_SUCCEEDS,
        makeParentVersion(),
        [makeScenario()],
      )

      expect(result.deltaH).to.be.closeTo(0.05, 0.001)
      expect(result.accepted).to.equal(true)
    })

    it('Δ = 0.06 → accepted', async () => {
      const {listOutcomes, store} = makeStoreStub(sb)
      const logger = makeLoggerStub(sb)

      // candidateH = 1.0 (always succeeds)
      // Need baselineH = 0.94 → sR = (0.94-0.8)/0.2 = 0.7
      // 50 outcomes, 35 successes → sR = 35/50 = 0.7 → H = 0.94
      // Δ = 1.0 - 0.94 = 0.06 → accepted
      listOutcomes.resolves(makeOutcomes(50, 35))

      const evaluator = new HarnessEvaluator(
        store,
        logger,
        () => makeSuccessTools(),
      )

      const result = await evaluator.evaluate(
        CANDIDATE_ALWAYS_SUCCEEDS,
        makeParentVersion(),
        [makeScenario()],
      )

      expect(result.deltaH).to.be.closeTo(0.06, 0.001)
      expect(result.accepted).to.equal(true)
    })
  })

  // -----------------------------------------------------------------------
  // Test 5: Syntax error in candidate code
  // -----------------------------------------------------------------------
  it('syntax error in candidate → CANDIDATE_LOAD_FAILED, accepted = false', async () => {
    const {listOutcomes, store} = makeStoreStub(sb)
    const logger = makeLoggerStub(sb)

    listOutcomes.resolves(makeOutcomes(50, 25))

    const evaluator = new HarnessEvaluator(
      store,
      logger,
      () => makeSuccessTools(),
    )

    const result = await evaluator.evaluate(
      CANDIDATE_SYNTAX_ERROR,
      makeParentVersion(),
      [makeScenario()],
    )

    expect(result.accepted).to.equal(false)
    expect(result.candidateHeuristic).to.equal(0)
    expect(result.details).to.have.lengthOf(0)
  })

  // -----------------------------------------------------------------------
  // Test 6: dryRun enforcement
  // -----------------------------------------------------------------------
  it('dryRun enforcement: curate throws WRITE_BLOCKED_DURING_EVAL; run marked as failure', async () => {
    const {listOutcomes, store} = makeStoreStub(sb)
    const logger = makeLoggerStub(sb)

    listOutcomes.resolves(makeOutcomes(50, 25))

    const evaluator = new HarnessEvaluator(
      store,
      logger,
      () => makeDryRunTools(),
    )

    const result = await evaluator.evaluate(
      CANDIDATE_CALLS_CURATE,
      makeParentVersion(),
      [makeScenario()],
    )

    // All 10 runs should fail due to WRITE_BLOCKED_DURING_EVAL
    expect(result.candidateHeuristic).to.equal(0)
    expect(result.accepted).to.equal(false)

    const [{runs}] = result.details
    expect(runs).to.have.lengthOf(EVAL_RUNS_PER_SCENARIO)
    expect(runs.every((r) => !r.success)).to.equal(true)

    // At least one run should capture the error message
    const hasWriteBlockedError = runs.some(
      (r) => r.stderr !== undefined && r.stderr.includes('WRITE_BLOCKED_DURING_EVAL'),
    )
    expect(hasWriteBlockedError).to.equal(true)
  })

  // -----------------------------------------------------------------------
  // Test 7: End-to-end with real sandbox
  // -----------------------------------------------------------------------
  it('end-to-end real sandbox: readFile-only candidate → all 10 runs succeed → H = 1.0', async () => {
    const {listOutcomes, store} = makeStoreStub(sb)
    const logger = makeLoggerStub(sb)

    // Low baseline: 15/50 successes → H = 0.2*(15/50)+0.8 = 0.86
    listOutcomes.resolves(makeOutcomes(50, 15))

    // Use real tools that allow readFile
    const realishTools: HarnessContextTools = {
      curate: (async () => {
        throw new HarnessEvaluatorError('WRITE_BLOCKED_DURING_EVAL')
      }) as unknown as HarnessContextTools['curate'],
      readFile: (async (_filePath: string) => ({
        content: 'export const x = 1',
        exists: true,
        path: '/test.ts',
      })) as unknown as HarnessContextTools['readFile'],
    }

    const evaluator = new HarnessEvaluator(
      store,
      logger,
      () => realishTools,
    )

    const result = await evaluator.evaluate(
      CANDIDATE_READS_ONLY,
      makeParentVersion(),
      [makeScenario()],
    )

    // All 10 runs succeed (only readFile called, which is allowed)
    expect(result.candidateHeuristic).to.equal(1)
    expect(result.accepted).to.equal(true)
    expect(result.details[0].runs.every((r) => r.success)).to.equal(true)
    expect(result.details[0].runs).to.have.lengthOf(EVAL_RUNS_PER_SCENARIO)
  })
})
