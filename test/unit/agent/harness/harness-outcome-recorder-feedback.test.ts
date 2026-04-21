import {expect} from 'chai'
import sinon from 'sinon'

import type {CodeExecOutcome} from '../../../../src/agent/core/domain/harness/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {HarnessStoreError, HarnessStoreErrorCode} from '../../../../src/agent/core/domain/errors/harness-store-error.js'
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

function makeLogger(): ILogger & {calls: Record<string, Array<{context?: Record<string, unknown>; message: string}>>} {
  const calls: Record<string, Array<{context?: Record<string, unknown>; message: string}>> = {
    debug: [],
    error: [],
    info: [],
    warn: [],
  }
  return {
    calls,
    debug(message: string, context?: Record<string, unknown>) {
      calls.debug.push({context, message})
    },
    error(message: string, context?: Record<string, unknown>) {
      calls.error.push({context, message})
    },
    info(message: string, context?: Record<string, unknown>) {
      calls.info.push({context, message})
    },
    warn(message: string, context?: Record<string, unknown>) {
      calls.warn.push({context, message})
    },
  }
}

/**
 * Seed a realistic outcome into the store for feedback tests.
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessOutcomeRecorder — attachFeedback', () => {
  let store: InMemoryHarnessStore
  let bus: SessionEventBus
  let logger: ReturnType<typeof makeLogger>

  beforeEach(() => {
    store = new InMemoryHarnessStore()
    bus = new SessionEventBus()
    logger = makeLogger()
  })

  afterEach(() => {
    sinon.restore()
  })

  // ── 1. verdict: 'bad' → 3 synthetics + field set ─────────────────────────

  it('attachFeedback(..., "bad") creates 3 synthetic outcomes with correct fields', async () => {
    const original = makeOutcome()
    await store.saveOutcome(original)

    const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'bad')

    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    // 1 original + 3 synthetics
    expect(outcomes).to.have.length(4)

    // Original has userFeedback set
    const flagged = outcomes.find((o) => o.id === 'outcome-1')
    expect(flagged).to.exist
    expect(flagged?.userFeedback).to.equal('bad')

    // 3 synthetics
    const synthetics = outcomes.filter((o) => o.id !== 'outcome-1')
    expect(synthetics).to.have.length(3)

    for (const s of synthetics) {
      // Fresh unique id
      expect(s.id).to.be.a('string').and.not.equal('outcome-1')
      // userFeedback set on synthetic
      expect(s.userFeedback).to.equal('bad')
      // Same timestamp as original
      expect(s.timestamp).to.equal(original.timestamp)
      // Same partition fields
      expect(s.projectId).to.equal(original.projectId)
      expect(s.commandType).to.equal(original.commandType)
      expect(s.projectType).to.equal(original.projectType)
      expect(s.sessionId).to.equal(original.sessionId)
      // Same content fields
      expect(s.code).to.equal(original.code)
      expect(s.success).to.equal(original.success)
      expect(s.executionTimeMs).to.equal(original.executionTimeMs)
      expect(s.usedHarness).to.equal(original.usedHarness)
    }

    // All 3 synthetics have distinct ids
    const syntheticIds = new Set(synthetics.map((s) => s.id))
    expect(syntheticIds.size).to.equal(3)
  })

  // ── 2. verdict: 'good' → 1 synthetic + field set ─────────────────────────

  it('attachFeedback(..., "good") creates 1 synthetic outcome', async () => {
    const original = makeOutcome()
    await store.saveOutcome(original)

    const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'good')

    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    // 1 original + 1 synthetic
    expect(outcomes).to.have.length(2)

    const flagged = outcomes.find((o) => o.id === 'outcome-1')
    expect(flagged?.userFeedback).to.equal('good')

    const synthetics = outcomes.filter((o) => o.id !== 'outcome-1')
    expect(synthetics).to.have.length(1)
    expect(synthetics[0].userFeedback).to.equal('good')
    expect(synthetics[0].timestamp).to.equal(original.timestamp)
  })

  // ── 3. verdict: null → field cleared, no synthetics ───────────────────────

  it('attachFeedback(..., null) clears the field with no synthetic inserts', async () => {
    const original = makeOutcome({userFeedback: 'bad'})
    await store.saveOutcome(original)

    const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', null)

    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    // Only the original — no synthetics
    expect(outcomes).to.have.length(1)
    expect(outcomes[0].userFeedback).to.equal(null)
  })

  // ── 4. Nonexistent outcome → OUTCOME_NOT_FOUND propagates ────────────────

  it('throws HarnessStoreError(OUTCOME_NOT_FOUND) when outcome does not exist', async () => {
    // Stub recordFeedback to throw like the real store does
    sinon.stub(store, 'recordFeedback').rejects(
      HarnessStoreError.outcomeNotFound('proj-1', 'curate', 'ghost-id'),
    )

    const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())

    try {
      await recorder.attachFeedback('proj-1', 'curate', 'ghost-id', 'bad')
      expect.fail('should have thrown')
    } catch (error) {
      expect(HarnessStoreError.isCode(error, HarnessStoreErrorCode.OUTCOME_NOT_FOUND)).to.equal(true)
    }
  })

  // ── 5. Synthetic-save failure → warn logged, other rows land ──────────────

  it('logs warn on synthetic-save failure but lands other rows and keeps field set', async () => {
    const original = makeOutcome()
    await store.saveOutcome(original)

    const originalSave = store.saveOutcome.bind(store)
    const stub = sinon.stub(store, 'saveOutcome')
    stub.callsFake(async (outcome: CodeExecOutcome) => originalSave(outcome))
    stub.onSecondCall().rejects(new Error('disk full'))

    const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
    // Should NOT throw — partial insertion is tolerable
    await recorder.attachFeedback('proj-1', 'curate', 'outcome-1', 'bad')

    // Original field is still set
    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    const flagged = outcomes.find((o) => o.id === 'outcome-1')
    expect(flagged?.userFeedback).to.equal('bad')

    // 2 of 3 synthetics landed (row #2 failed)
    const synthetics = outcomes.filter((o) => o.id !== 'outcome-1')
    expect(synthetics).to.have.length(2)

    // Warn was logged
    expect(logger.calls.warn.length).to.be.greaterThanOrEqual(1)
  })

  // ── 6. Old outcome not in listOutcomes(100) → field set, no synthetics ────

  it('sets field but skips synthetics when outcome is older than the 100 most recent', async () => {
    // Seed 100 newer outcomes to push the target out of the window
    const target = makeOutcome({id: 'old-outcome', timestamp: 1})
    await store.saveOutcome(target)

    await Promise.all(
      Array.from({length: 100}, (_, i) =>
        store.saveOutcome(makeOutcome({id: `newer-${i}`, timestamp: 1000 + i})),
      ),
    )

    const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
    await recorder.attachFeedback('proj-1', 'curate', 'old-outcome', 'bad')

    // Field is set on the old outcome
    const all = await store.listOutcomes('proj-1', 'curate', 200)
    const flagged = all.find((o) => o.id === 'old-outcome')
    expect(flagged?.userFeedback).to.equal('bad')

    // No synthetics were added — total count is still 101 (100 newer + 1 old)
    expect(all).to.have.length(101)

    // Warn was logged about old outcome
    expect(logger.calls.warn.length).to.be.greaterThanOrEqual(1)
    expect(logger.calls.warn.some((c) => c.message.toLowerCase().includes('old')
      || c.message.toLowerCase().includes('not found in recent')
      || c.message.toLowerCase().includes('skip'))).to.equal(true)
  })

  // ── 7. Concurrent: 10 parallel attachFeedback calls → all complete ────────

  it('10 parallel attachFeedback("bad") calls on distinct outcomes → 30 synthetics, all fast', async () => {
    // Seed 10 distinct outcomes
    await Promise.all(
      Array.from({length: 10}, (_, i) =>
        store.saveOutcome(makeOutcome({id: `oc-${i}`, timestamp: 1000 + i})),
      ),
    )

    const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())

    const promises = Array.from({length: 10}, (_, i) =>
      recorder.attachFeedback('proj-1', 'curate', `oc-${i}`, 'bad'),
    )
    await Promise.all(promises)

    const outcomes = await store.listOutcomes('proj-1', 'curate', 200)
    // 10 originals + 30 synthetics
    expect(outcomes).to.have.length(40)

    // All originals flagged
    for (let i = 0; i < 10; i++) {
      const flagged = outcomes.find((o) => o.id === `oc-${i}`)
      expect(flagged?.userFeedback).to.equal('bad')
    }
  })
})
