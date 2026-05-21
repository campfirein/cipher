 
import {expect} from 'chai'
import sinon from 'sinon'

import type {IAnalyticsClient} from '../../../../../src/server/core/interfaces/analytics/i-analytics-client.js'
import type {IAnalyticsQueue} from '../../../../../src/server/core/interfaces/analytics/i-analytics-queue.js'
import type {IJsonlAnalyticsStore} from '../../../../../src/server/core/interfaces/analytics/i-jsonl-analytics-store.js'
import type {StoredAnalyticsRecord} from '../../../../../src/shared/analytics/stored-record.js'

import {AnalyticsBatch} from '../../../../../src/server/core/domain/analytics/batch.js'
import {wireAnalyticsFlushScheduler} from '../../../../../src/server/infra/process/wire-analytics-flush-scheduler.js'

/**
 * Integration test for the M4.3 composition-root binding that wires
 * AnalyticsClient.flush() ⇄ AnalyticsFlushScheduler. Mirrors the M4.1 /
 * M4.2 wiring-helper precedent: every composition-root binding gets a
 * focused integration test so a future misconfigured wiring (wrong
 * isEnabled gate, missing queue ref, swapped intervals) is caught at
 * unit-test speed without booting the whole daemon.
 */

type FakeClient = IAnalyticsClient & {readonly flushCalls: number; resetFlushCalls(): void}

function makeFakeClient(): FakeClient {
  let calls = 0
  const stub: FakeClient = {
    async flush() {
      calls += 1
      return AnalyticsBatch.create([])
    },
    get flushCalls() {
      return calls
    },
    async onAuthTransition() {},
    resetFlushCalls() {
      calls = 0
    },
    // Hand-rolled noop preserves the generic `track<E>` signature.
    track() {
      /* no-op */
    },
  }
  return stub
}

const noop = (): void => {
  /* no-op */
}

const asyncNoop = async (): Promise<void> => {}

function makeQueueStub(size: number): IAnalyticsQueue {
  return {
    drain: () => [],
    droppedCount: () => 0,
    push: noop,
    size: () => size,
  }
}

/**
 * Build a stub `IJsonlAnalyticsStore` whose `loadPending()` returns a
 * synthetic list of `pendingCount` records. The scheduler only inspects
 * `length`, so the record shapes are irrelevant — we keep them minimal
 * while still matching the `StoredAnalyticsRecord` schema (camelCase
 * `deviceId` only — wire-shape snake_case lives in the identity sub-DTO
 * but our domain entity reflects the in-memory representation).
 */
function makeJsonlStoreStub(pendingCount: number): IJsonlAnalyticsStore {
  /* eslint-disable camelcase */
  const records: StoredAnalyticsRecord[] = Array.from({length: pendingCount}, (_, i) => ({
    attempts: 0,
    id: `r${String(i)}`,
    identity: {device_id: '550e8400-e29b-41d4-a716-446655440000'},
    name: 'daemon_start',
    properties: {},
    status: 'pending',
    timestamp: 0,
  }))
  /* eslint-enable camelcase */
  return {
    append: asyncNoop,
    clear: asyncNoop,
    droppedFullCount: () => 0,
    droppedSentCount: () => 0,
    list: async () => ({rows: records, total: records.length}),
    loadPending: async () => records,
    updateStatus: asyncNoop,
  }
}

describe('M4.3 wireAnalyticsFlushScheduler (integration)', () => {
  let clock: sinon.SinonFakeTimers

  beforeEach(() => {
    clock = sinon.useFakeTimers()
  })

  afterEach(() => {
    clock.restore()
  })

  it('returns a scheduler that flushes via the wired client on the configured interval', async () => {
    const client = makeFakeClient()
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: client,
      intervalMs: 100,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(5),
      queue: makeQueueStub(5),
    })

    scheduler.start()
    await clock.tickAsync(100)

    expect(client.flushCalls).to.equal(1)
    scheduler.stop()
  })

  it('honors the isEnabled gate (disabled analytics → no flush on tick)', async () => {
    const client = makeFakeClient()
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: client,
      intervalMs: 100,
      isEnabled: () => false,
      jsonlStore: makeJsonlStoreStub(5),
      queue: makeQueueStub(5),
    })

    scheduler.start()
    await clock.tickAsync(500)

    expect(client.flushCalls).to.equal(0)
    scheduler.stop()
  })

  it('skips interval flush when JSONL pending=0 even though queue mirror is non-zero (regression for queue-never-decrements)', async () => {
    // Regression: BoundedQueue.push grows the mirror but flush only
    // shrinks JSONL pending (queue.drain runs on auth transitions, not
    // flushes). If the scheduler gated on queue.size() it would fire
    // every 30s indefinitely after the first track ever; gating on
    // pendingCount keeps the scheduler quiet once everything has shipped.
    const client = makeFakeClient()
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: client,
      intervalMs: 100,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(0), // nothing left to ship
      queue: makeQueueStub(50), // mirror still reflects past pushes
    })

    scheduler.start()
    await clock.tickAsync(500)

    expect(client.flushCalls, 'mirror-non-zero must NOT trigger flushes when pending=0').to.equal(0)
    scheduler.stop()
  })

  it('honors the queue size for the empty-skip path', async () => {
    const client = makeFakeClient()
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: client,
      intervalMs: 100,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(0),
      queue: makeQueueStub(0),
    })

    scheduler.start()
    await clock.tickAsync(500)

    expect(client.flushCalls, 'empty queue must NOT trigger a flush').to.equal(0)
    scheduler.stop()
  })

  it('threshold trigger uses the wired threshold via notifyPushed()', async () => {
    const client = makeFakeClient()
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: client,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(20),
      queue: makeQueueStub(20),
      thresholdCount: 20,
    })

    scheduler.notifyPushed()
    // notifyPushed defers via setImmediate; tick once to drain it.
    await clock.tickAsync(1)

    expect(client.flushCalls).to.equal(1)
  })

  it('flushFinal joins an in-flight flush rather than starting a second send', async () => {
    let releaseFlush!: () => void
    const slowClient: IAnalyticsClient = {
      flush: () =>
        new Promise<AnalyticsBatch>((resolve) => {
          releaseFlush = () => resolve(AnalyticsBatch.create([]))
        }),
      async onAuthTransition() {},
      track() {
        /* no-op */
      },
    }
    let flushCount = 0
    const flushSpy: IAnalyticsClient = {
      ...slowClient,
      async flush() {
        flushCount += 1
        return slowClient.flush()
      },
    }

    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: flushSpy,
      intervalMs: 100,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(5),
      queue: makeQueueStub(5),
    })
    scheduler.start()

    await clock.tickAsync(100)
    expect(flushCount).to.equal(1)

    const finalPromise = scheduler.flushFinal({timeoutMs: 3000})
    releaseFlush()
    await finalPromise

    expect(flushCount, 'flushFinal must join in-flight').to.equal(1)
    scheduler.stop()
  })

  it('flushFinal resolves under the timeout when flush never settles', async () => {
    const slowClient: IAnalyticsClient = {
      flush: () =>
        new Promise<AnalyticsBatch>(() => {
          /* never resolves */
        }),
      async onAuthTransition() {},
      track() {
        /* no-op */
      },
    }
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: slowClient,
      intervalMs: 100,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(5),
      queue: makeQueueStub(5),
    })

    const finalPromise = scheduler.flushFinal({timeoutMs: 3000})
    await clock.tickAsync(3000)
    await finalPromise
    // Reaching here proves the timeout resolved the race.
    expect(true).to.equal(true)
  })

  it('uses the default 30s interval when intervalMs is omitted', async () => {
    const client = makeFakeClient()
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: client,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(5),
      queue: makeQueueStub(5),
    })

    scheduler.start()
    await clock.tickAsync(29_999)
    expect(client.flushCalls).to.equal(0)
    await clock.tickAsync(1)
    expect(client.flushCalls).to.equal(1)
    scheduler.stop()
  })

  it('uses the default 20-event threshold when thresholdCount is omitted', async () => {
    const client = makeFakeClient()
    const scheduler = wireAnalyticsFlushScheduler({
      analyticsClient: client,
      isEnabled: () => true,
      jsonlStore: makeJsonlStoreStub(19),
      queue: makeQueueStub(19),
    })

    scheduler.notifyPushed()
    await clock.tickAsync(1)
    expect(client.flushCalls, 'below default threshold of 20 → no flush').to.equal(0)
  })
})
