import {expect} from 'chai'

import type {CodeExecOutcome} from '../../../../src/agent/core/domain/harness/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {computeHeuristic} from '../../../../src/agent/core/domain/harness/heuristic.js'
import {SessionEventBus} from '../../../../src/agent/infra/events/event-emitter.js'
import {HarnessOutcomeRecorder} from '../../../../src/agent/infra/harness/harness-outcome-recorder.js'
import {InMemoryHarnessStore} from '../../../helpers/in-memory-harness-store.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

function makeLogger(): ILogger {
  return {
    debug() {},
    error() {},
    info() {},
    warn() {},
  }
}

/** Seed a realistic outcome into the store. */
function makeOutcome(overrides: Partial<CodeExecOutcome> = {}): CodeExecOutcome {
  return {
    code: 'tools.search("x")',
    commandType: 'curate',
    executionTimeMs: 42,
    id: 'outcome-1',
    projectId: 'proj-1',
    projectType: 'typescript',
    sessionId: 'sess-1',
    success: true,
    timestamp: 1000,
    usedHarness: false,
    ...overrides,
  }
}

function assertDefined<T>(value: null | T | undefined, label: string): asserts value is T {
  if (value === null || value === undefined) throw new Error(`expected ${label} to be defined`)
}

/** Count outcomes whose id contains `__synthetic_`. */
async function countSynthetics(
  store: InMemoryHarnessStore,
  projectId: string,
  commandType: string,
): Promise<number> {
  const outcomes = await store.listOutcomes(projectId, commandType, 200)
  return outcomes.filter((o) => o.id.includes('__synthetic_')).length
}

// ---------------------------------------------------------------------------
// Tests — 7 scenarios per ticket spec
// ---------------------------------------------------------------------------

describe('HarnessOutcomeRecorder — synthetic feedback weighting', () => {
  let store: InMemoryHarnessStore
  let bus: SessionEventBus
  let recorder: HarnessOutcomeRecorder

  beforeEach(() => {
    store = new InMemoryHarnessStore()
    bus = new SessionEventBus()
    recorder = new HarnessOutcomeRecorder(store, bus, makeLogger(), makeConfig())
  })

  // ── 1. bad → 3 synthetic success:false with __synthetic_bad_ prefix ──────

  it('recordFeedback(id, "bad") inserts 3 synthetic failures with __synthetic_bad_ prefix', async () => {
    const original = makeOutcome({success: true})
    await store.saveOutcome(original)

    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'bad')

    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    // 1 original + 3 synthetics
    expect(outcomes).to.have.length(4)

    // Synthetics use deterministic __synthetic_ IDs
    const synthetics = outcomes.filter((o) => o.id.includes('__synthetic_bad_'))
    expect(synthetics).to.have.length(3)

    for (const s of synthetics) {
      expect(s.id).to.match(/^outcome-1__synthetic_bad_\d$/)
      expect(s.userFeedback).to.equal('bad')
    }
  })

  // ── 2. good → 1 synthetic success:true ───────────────────────────────────

  it('recordFeedback(id, "good") inserts 1 synthetic success with __synthetic_good_ prefix', async () => {
    const original = makeOutcome()
    await store.saveOutcome(original)

    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'good')

    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    // 1 original + 1 synthetic
    expect(outcomes).to.have.length(2)

    const synthetics = outcomes.filter((o) => o.id.includes('__synthetic_good_'))
    expect(synthetics).to.have.length(1)
    expect(synthetics[0].id).to.equal('outcome-1__synthetic_good_0')
    expect(synthetics[0].userFeedback).to.equal('good')
  })

  // ── 3. null → clears previously-inserted synthetics ──────────────────────

  it('recordFeedback(id, null) clears previously-inserted synthetics', async () => {
    const original = makeOutcome()
    await store.saveOutcome(original)

    // First: flag as bad → 3 synthetics
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'bad')
    const afterBad = await store.listOutcomes('proj-1', 'curate', 200)
    expect(afterBad).to.have.length(4)

    // Then: null → synthetics removed, field cleared
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', null)
    const afterNull = await store.listOutcomes('proj-1', 'curate', 200)
    // Only original remains
    expect(afterNull).to.have.length(1)
    expect(afterNull[0].id).to.equal('outcome-1')
    expect(afterNull[0].userFeedback).to.equal(null)
  })

  // ── 4. re-label bad→good: old synthetics removed, new added ─────────────

  it('re-label bad→good removes 3 bad synthetics and inserts 1 good synthetic', async () => {
    const original = makeOutcome()
    await store.saveOutcome(original)

    // Flag as bad → 3 bad synthetics
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'bad')
    const afterBad = await store.listOutcomes('proj-1', 'curate', 200)
    expect(afterBad).to.have.length(4)

    // Re-label to good → bad synthetics removed, 1 good added
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'good')
    const afterGood = await store.listOutcomes('proj-1', 'curate', 200)
    // 1 original + 1 good synthetic
    expect(afterGood).to.have.length(2)

    // No bad synthetics remain
    const badSynthetics = afterGood.filter((o) => o.id.includes('__synthetic_bad_'))
    expect(badSynthetics).to.have.length(0)

    // 1 good synthetic present
    const goodSynthetics = afterGood.filter((o) => o.id.includes('__synthetic_good_'))
    expect(goodSynthetics).to.have.length(1)

    // Original field updated
    const flagged = afterGood.find((o) => o.id === 'outcome-1')
    expect(flagged?.userFeedback).to.equal('good')
  })

  // ── 5. cap enforcement: >10 synthetics in window → oldest trimmed ────────

  it('enforces cap of 10 feedback synthetics in the 50-outcome window', async () => {
    // Seed 4 distinct outcomes and flag each as 'bad' → 4*3 = 12 synthetics
    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.saveOutcome(makeOutcome({id: `oc-${i}`, timestamp: 1000 + i}))
    }

    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      await recorder.attachFeedback('proj-1', 'curate', `oc-${i}`, 'bad')
    }

    // Cap enforcement should trim to at most 10 synthetics
    const syntheticCount = await countSynthetics(store, 'proj-1', 'curate')
    expect(syntheticCount).to.be.at.most(10)
  })

  // ── 6. feedback on non-existent outcome → no-op, no throw ───────────────

  it('feedback on non-existent outcome is a no-op', async () => {
    // InMemoryHarnessStore.recordFeedback is a no-op on miss (doesn't throw).
    // attachFeedback should complete without error or synthetics.
    await recorder.attachFeedback('proj-1', 'curate', 'ghost-id', 'bad')

    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    expect(outcomes).to.have.length(0)
  })

  // ── 7. H drops after bad feedback ────────────────────────────────────────

  it('computeHeuristic drops after recordFeedback(id, "bad")', async () => {
    const now = Date.now()
    // Seed multiple successful outcomes with recent timestamps
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.saveOutcome(
        makeOutcome({id: `oc-${i}`, success: true, timestamp: now - 10_000 + i}),
      )
    }

    const baselineH = computeHeuristic(
      await store.listOutcomes('proj-1', 'curate', 50),
      now,
    )
    // Baseline H = 0.2·successRate + 0.3·(1-errorRate) + 0.5·realHarnessRate
    // = 0.2·1.0 + 0.3·1.0 + 0.5·0 = 0.5 for all-success, no-harness outcomes
    expect(baselineH).to.not.equal(null)
    expect(baselineH).to.equal(0.5)

    // Flag one outcome as bad → 3 synthetic failures inserted
    await recorder.attachFeedback('proj-1', 'curate', 'oc-0', 'bad')

    const afterH = computeHeuristic(
      await store.listOutcomes('proj-1', 'curate', 50),
      now,
    )
    assertDefined(afterH, 'afterH')
    assertDefined(baselineH, 'baselineH')
    // H should have dropped due to the 3 synthetic failures
    expect(afterH).to.be.lessThan(baselineH)
  })
})
