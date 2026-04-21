import {expect} from 'chai'
import sinon from 'sinon'

import type {CodeExecOutcome} from '../../../../src/agent/core/domain/harness/types.js'
import type {REPLResult} from '../../../../src/agent/core/domain/sandbox/types.js'
import type {ILogger} from '../../../../src/agent/core/interfaces/i-logger.js'
import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'
import type {RecordParams} from '../../../../src/agent/infra/harness/harness-outcome-recorder.js'

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

function makeResult(overrides: Partial<REPLResult> = {}): REPLResult {
  return {
    executionTime: 42,
    locals: {},
    stderr: '',
    stdout: 'ok',
    ...overrides,
  }
}

function makeParams(overrides: Partial<RecordParams> = {}): RecordParams {
  return {
    code: 'tools.search("x")',
    commandType: 'curate',
    executionTimeMs: 42,
    projectId: 'proj-1',
    projectType: 'typescript',
    result: makeResult(),
    sessionId: 'sess-1',
    ...overrides,
  }
}

async function recordN(recorder: HarnessOutcomeRecorder, n: number, overrides: Partial<RecordParams> = {}): Promise<void> {
  const promises = Array.from({length: n}, () => recorder.record(makeParams(overrides)))
  await Promise.all(promises)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessOutcomeRecorder', () => {
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

  // ── Config-gated ──────────────────────────────────────────────────────────

  describe('config.enabled: false', () => {
    it('does not call store.saveOutcome and does not emit events', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig({enabled: false}))
      const spy = sinon.spy(store, 'saveOutcome')
      let emitted = false
      bus.on('harness:outcome-recorded', () => {
        emitted = true
      })

      await recorder.record(makeParams())

      expect(spy.callCount).to.equal(0)
      expect(emitted).to.equal(false)
    })
  })

  // ── Usage detection ───────────────────────────────────────────────────────

  describe('usage detection', () => {
    it('detects usedHarness: true when code contains harness.curate', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recorder.record(makeParams({
        code: 'const r = harness.curate(input)',
        harnessVersionId: 'hv-1',
      }))

      const outcomes = await store.listOutcomes('proj-1', 'curate')
      expect(outcomes).to.have.length(1)
      expect(outcomes[0].usedHarness).to.equal(true)
    })

    it('detects usedHarness: false when code uses only tools.*', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recorder.record(makeParams({code: 'tools.search("x")'}))

      const outcomes = await store.listOutcomes('proj-1', 'curate')
      expect(outcomes).to.have.length(1)
      expect(outcomes[0].usedHarness).to.equal(false)
    })

    it('logs warn and downgrades usedHarness when harnessVersionId missing', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recorder.record(makeParams({
        code: 'harness.curate(input)',
        harnessVersionId: undefined,
      }))

      const outcomes = await store.listOutcomes('proj-1', 'curate')
      expect(outcomes).to.have.length(1)
      expect(outcomes[0].usedHarness).to.equal(false)
      expect(logger.calls.warn.length).to.be.greaterThanOrEqual(1)
      expect(logger.calls.warn.some((c) => c.message.includes('harnessVersionId'))).to.equal(true)
    })

    it('persists usedHarness: true with harnessVersionId present', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recorder.record(makeParams({
        code: 'harness.query(q)',
        harnessVersionId: 'hv-1',
      }))

      const outcomes = await store.listOutcomes('proj-1', 'curate')
      expect(outcomes).to.have.length(1)
      expect(outcomes[0].usedHarness).to.equal(true)
      expect(outcomes[0].harnessVersionId).to.equal('hv-1')
    })
  })

  // ── Rate limit ────────────────────────────────────────────────────────────

  describe('rate limit', () => {
    it('persists all 50 outcomes for the same sessionId', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recordN(recorder, 50, {sessionId: 's1'})

      const outcomes = await store.listOutcomes('proj-1', 'curate', 100)
      expect(outcomes).to.have.length(50)
    })

    it('does not persist the 51st call for the same sessionId', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recordN(recorder, 51, {sessionId: 's1'})

      const outcomes = await store.listOutcomes('proj-1', 'curate', 100)
      expect(outcomes).to.have.length(50)
    })

    it('rate-limited call still updates commandType set', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recordN(recorder, 50, {commandType: 'curate', sessionId: 's1'})

      // 51st call with a different commandType — should still track it
      await recorder.record(makeParams({commandType: 'query', sessionId: 's1'}))

      const types = recorder.getCommandTypesForSession('s1')
      expect(types.has('curate')).to.equal(true)
      expect(types.has('query')).to.equal(true)
    })

    it('rate limit is per-session: s2 persists after s1 is capped', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recordN(recorder, 50, {sessionId: 's1'})
      await recorder.record(makeParams({sessionId: 's2'}))

      const outcomes = await store.listOutcomes('proj-1', 'curate', 100)
      // 50 from s1, 1 from s2
      expect(outcomes).to.have.length(51)
    })
  })

  // ── Concurrency ───────────────────────────────────────────────────────────

  describe('bounded concurrency', () => {
    it('all 10 parallel record calls eventually persist', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      const promises = Array.from({length: 10}, (_, i) =>
        recorder.record(makeParams({sessionId: `s-${i}`})),
      )

      await Promise.all(promises)

      const outcomes = await store.listOutcomes('proj-1', 'curate', 100)
      expect(outcomes).to.have.length(10)
    })

    it('at most 5 store.saveOutcome calls are in-flight at any moment', async () => {
      let inFlight = 0
      let highWater = 0
      const originalSave = store.saveOutcome.bind(store)

      sinon.stub(store, 'saveOutcome').callsFake(async (outcome: CodeExecOutcome) => {
        inFlight++
        if (inFlight > highWater) highWater = inFlight
        // Simulate a slow write
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10)
        })
        const result = await originalSave(outcome)
        inFlight--
        return result
      })

      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      const promises = Array.from({length: 10}, (_, i) =>
        recorder.record(makeParams({sessionId: `s-${i}`})),
      )

      await Promise.all(promises)

      expect(highWater).to.be.at.most(5)
      const outcomes = await store.listOutcomes('proj-1', 'curate', 100)
      expect(outcomes).to.have.length(10)
    })
  })

  // ── Event emission ────────────────────────────────────────────────────────

  describe('event emission', () => {
    it('emits harness:outcome-recorded after successful write', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      const events: Array<{commandType: string; outcomeId: string; projectId: string; success: boolean}> = []
      bus.on('harness:outcome-recorded', (payload) => {
        events.push(payload)
      })

      await recorder.record(makeParams({commandType: 'curate', projectId: 'proj-1'}))

      expect(events).to.have.length(1)
      expect(events[0].commandType).to.equal('curate')
      expect(events[0].projectId).to.equal('proj-1')
      expect(events[0].success).to.equal(true)
      expect(events[0].outcomeId).to.be.a('string').and.not.empty
    })

    it('does NOT emit when store.saveOutcome fails', async () => {
      sinon.stub(store, 'saveOutcome').rejects(new Error('storage down'))
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      const events: unknown[] = []
      bus.on('harness:outcome-recorded', (payload) => {
        events.push(payload)
      })

      await recorder.record(makeParams())

      expect(events).to.have.length(0)
    })
  })

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('logs warn and resolves when store.saveOutcome rejects', async () => {
      sinon.stub(store, 'saveOutcome').rejects(new Error('storage down'))
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())

      // Should not throw
      await recorder.record(makeParams())

      expect(logger.calls.warn.length).to.be.greaterThanOrEqual(1)
    })

    it('logs warn and resolves when store.saveOutcome throws synchronously', async () => {
      sinon.stub(store, 'saveOutcome').throws(new Error('sync boom'))
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())

      await recorder.record(makeParams())

      expect(logger.calls.warn.length).to.be.greaterThanOrEqual(1)
    })
  })

  // ── Session state ─────────────────────────────────────────────────────────

  describe('session state (getCommandTypesForSession)', () => {
    it('tracks commandTypes across multiple record calls', async () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      await recorder.record(makeParams({commandType: 'curate', sessionId: 's1'}))
      await recorder.record(makeParams({commandType: 'query', sessionId: 's1'}))

      const types = recorder.getCommandTypesForSession('s1')
      expect(types.has('curate')).to.equal(true)
      expect(types.has('query')).to.equal(true)
    })

    it('returns empty set for unknown sessionId', () => {
      const recorder = new HarnessOutcomeRecorder(store, bus, logger, makeConfig())
      const types = recorder.getCommandTypesForSession('unknown')
      expect(types.size).to.equal(0)
    })
  })
})
