 
import {expect} from 'chai'
import sinon from 'sinon'

import {AnalyticsFlushScheduler} from '../../../../../src/server/infra/analytics/analytics-flush-scheduler.js'

type Deps = {
  flush: sinon.SinonStub
  isEnabled: sinon.SinonStub
  pendingCount: sinon.SinonStub
  queueSize: sinon.SinonStub
}

function buildDeps(
  overrides: Partial<{
    enabled: boolean
    flushImpl: () => Promise<void>
    /**
     * Shared depth for both `queueSize` (sync, threshold trigger) and
     * `pendingCount` (async, empty-skip gate). Tests that want to
     * distinguish the two paths override one stub explicitly after this
     * call; the default keeps them in sync to mirror the steady-state
     * production invariant (a record pushed is a record pending).
     */
    size: number
  }> = {},
): Deps {
  const size = overrides.size ?? 0
  return {
    flush: sinon.stub().callsFake(overrides.flushImpl ?? (async () => {})),
    isEnabled: sinon.stub().returns(overrides.enabled ?? true),
    pendingCount: sinon.stub().resolves(size),
    queueSize: sinon.stub().returns(size),
  }
}

// Shared fixture: a `flush` impl that never settles. Used by the
// timeout-budget tests to prove `flushFinal` resolves on the timer side
// of the race regardless of how slow the underlying flush is.
const neverResolvingFlush = (): Promise<void> =>
  new Promise<void>(() => {
    /* intentional never-settle */
  })

async function flushMicrotasks(): Promise<void> {
  // Drain microtasks AND setImmediate so notifyPushed's scheduled flush runs.
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

describe('AnalyticsFlushScheduler', () => {
  describe('interval timer', () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
      clock = sinon.useFakeTimers()
    })

    afterEach(() => {
      clock.restore()
    })

    it('does NOT flush before the interval elapses', async () => {
      const deps = buildDeps({size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(29_000)

      expect(deps.flush.called).to.equal(false)
      scheduler.stop()
    })

    it('flushes once when the interval elapses with a non-empty queue', async () => {
      const deps = buildDeps({size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(30_000)

      expect(deps.flush.calledOnce).to.equal(true)
      scheduler.stop()
    })

    it('does NOT flush at the interval when the queue is empty', async () => {
      const deps = buildDeps({size: 0})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(60_000)

      expect(deps.flush.called).to.equal(false)
      scheduler.stop()
    })

    it('gates the empty-skip on pendingCount, NOT queueSize (mirror-non-zero with pending=0 is silent)', async () => {
      // Regression for the queue-mirror-never-decrements behavior: the
      // in-memory queue grows on push but is only drained on auth
      // transitions, so after a successful flush queueSize() > 0 yet
      // pendingCount() === 0. The scheduler must consult the JSONL-
      // backed pendingCount; using queueSize would re-fire flushes
      // every 30s forever for an empty backlog.
      const deps = buildDeps({size: 0}) // pendingCount + queueSize default sync
      deps.queueSize.returns(50) // mirror still reflects past pushes
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(90_000) // three intervals

      expect(deps.flush.called, 'mirror-non-zero with pending=0 must NOT trigger').to.equal(false)
      scheduler.stop()
    })

    it('skips the tick when analytics is disabled', async () => {
      const deps = buildDeps({enabled: false, size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(60_000)

      expect(deps.flush.called).to.equal(false)
      scheduler.stop()
    })

    it('fires every interval, not just once (recurring timer)', async () => {
      const deps = buildDeps({size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(30_000)
      await clock.tickAsync(30_000)
      await clock.tickAsync(30_000)

      expect(deps.flush.callCount).to.equal(3)
      scheduler.stop()
    })

    it('stop() halts further ticks', async () => {
      const deps = buildDeps({size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()
      await clock.tickAsync(30_000)
      scheduler.stop()

      await clock.tickAsync(60_000)

      expect(deps.flush.callCount).to.equal(1)
    })

    it('start() is idempotent (double-start does NOT install two timers)', async () => {
      const deps = buildDeps({size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()
      scheduler.start()

      await clock.tickAsync(30_000)

      expect(deps.flush.callCount).to.equal(1)
      scheduler.stop()
    })
  })

  describe('threshold trigger via notifyPushed()', () => {
    it('flushes via setImmediate when queue.size() crosses the threshold', async () => {
      const deps = buildDeps({size: 20})
      const scheduler = new AnalyticsFlushScheduler({...deps, thresholdCount: 20})

      scheduler.notifyPushed()
      // `notifyPushed` returns synchronously; flush runs on the next setImmediate tick.
      expect(deps.flush.called, 'flush must be deferred, not synchronous').to.equal(false)

      await flushMicrotasks()

      expect(deps.flush.calledOnce).to.equal(true)
    })

    it('does NOT flush when queue.size() is below the threshold', async () => {
      const deps = buildDeps({size: 19})
      const scheduler = new AnalyticsFlushScheduler({...deps, thresholdCount: 20})

      scheduler.notifyPushed()
      await flushMicrotasks()

      expect(deps.flush.called).to.equal(false)
    })

    it('does NOT flush when analytics is disabled', async () => {
      const deps = buildDeps({enabled: false, size: 100})
      const scheduler = new AnalyticsFlushScheduler({...deps, thresholdCount: 20})

      scheduler.notifyPushed()
      await flushMicrotasks()

      expect(deps.flush.called).to.equal(false)
    })

    it('does NOT re-trigger between threshold multiples (regression: queue mirror is monotonic past 20 → every push would fire)', async () => {
      // The queue mirror only decrements on auth-transition drain, NOT on a
      // successful flush. Without a moving baseline, queueSize >= 20 stays
      // true forever after the first crossing, so every subsequent track
      // would schedule a fresh setImmediate→tryFlush→HTTP POST and the
      // 20-event batching contract would collapse for slow-emit workloads.
      const deps = buildDeps({size: 5}) // pendingCount > 0 so tryFlush proceeds past the empty-skip gate
      deps.queueSize.onCall(0).returns(20)
      deps.queueSize.onCall(1).returns(21)
      deps.queueSize.onCall(2).returns(22)
      deps.queueSize.onCall(3).returns(39)
      deps.queueSize.onCall(4).returns(40)
      const scheduler = new AnalyticsFlushScheduler({...deps, thresholdCount: 20})

      scheduler.notifyPushed() // size=20: cross 1st threshold → fire
      scheduler.notifyPushed() // size=21: must NOT fire
      scheduler.notifyPushed() // size=22: must NOT fire
      scheduler.notifyPushed() // size=39: must NOT fire
      scheduler.notifyPushed() // size=40: cross 2nd threshold → fire
      await flushMicrotasks()

      expect(deps.flush.callCount, 'threshold must fire only at 20 and 40, not on every push past 20').to.equal(2)
    })

    it('resets baseline when queue is drained below previous trigger size (auth transition)', async () => {
      // M4.1 onAuthTransition drains the queue mirror. After a drain, the
      // next 20-event crossing must fire again — without baseline reset,
      // the comparison `size - lastTrigger` would go negative and stay
      // sub-threshold forever after a login/logout cycle.
      const deps = buildDeps({size: 5})
      deps.queueSize.onCall(0).returns(20) // 1st trigger
      deps.queueSize.onCall(1).returns(0) // drain
      deps.queueSize.onCall(2).returns(20) // re-built post-drain → must fire again
      const scheduler = new AnalyticsFlushScheduler({...deps, thresholdCount: 20})

      scheduler.notifyPushed()
      scheduler.notifyPushed()
      scheduler.notifyPushed()
      await flushMicrotasks()

      expect(deps.flush.callCount, 'drain must reset baseline so next 20 push fires again').to.equal(2)
    })
  })

  describe('idempotency (single-flight)', () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
      clock = sinon.useFakeTimers()
    })

    afterEach(() => {
      clock.restore()
    })

    it('does NOT issue a second flush while one is already in flight (timer + threshold race)', async () => {
      let releaseFlush!: () => void
      const slowFlush = (): Promise<void> =>
        new Promise<void>((resolve) => {
          releaseFlush = resolve
        })
      const deps = buildDeps({flushImpl: slowFlush, size: 25})
      const scheduler = new AnalyticsFlushScheduler({
        ...deps,
        intervalMs: 30_000,
        thresholdCount: 20,
      })
      scheduler.start()

      // Timer fires → flush (1) starts and stays pending.
      await clock.tickAsync(30_000)
      expect(deps.flush.callCount).to.equal(1)

      // Threshold trip while flush-1 is in flight: setImmediate is faked
      // so we tick once to drain it; the trigger must still be skipped.
      scheduler.notifyPushed()
      await clock.tickAsync(1)
      expect(deps.flush.callCount, 'in-flight flush must skip new triggers').to.equal(1)

      // Another timer tick before flush-1 settles: also skipped.
      await clock.tickAsync(30_000)
      expect(deps.flush.callCount).to.equal(1)

      // Settle flush-1. After settle, next trigger should run fresh.
      releaseFlush()
      await clock.tickAsync(0)

      // Grow the queue past the next threshold (25 → 45, delta 20). The
      // post-fix notifyPushed gates on the DELTA since the last trigger,
      // not the absolute size, so a follow-up call with the same size
      // would correctly be a no-op.
      deps.queueSize.returns(45)
      scheduler.notifyPushed()
      await clock.tickAsync(1)
      expect(deps.flush.callCount, 'new trigger after settle must run').to.equal(2)
      scheduler.stop()
    })

    it('continues to flush on the next interval after the in-flight settles', async () => {
      let releaseFlush!: () => void
      const slowFlush = (): Promise<void> =>
        new Promise<void>((resolve) => {
          releaseFlush = resolve
        })
      const deps = buildDeps({flushImpl: slowFlush, size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(30_000)
      expect(deps.flush.callCount).to.equal(1)

      releaseFlush()
      await clock.tickAsync(0)

      await clock.tickAsync(30_000)
      expect(deps.flush.callCount).to.equal(2)
      scheduler.stop()
    })
  })

  describe('flushFinal() for shutdown', () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
      clock = sinon.useFakeTimers()
    })

    afterEach(() => {
      clock.restore()
    })

    it('returns the flush result when flush completes within the timeout', async () => {
      const deps = buildDeps({async flushImpl() {}, size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})

      const promise = scheduler.flushFinal({timeoutMs: 3000})
      await clock.tickAsync(1)
      await promise

      expect(deps.flush.calledOnce).to.equal(true)
    })

    it('resolves after the timeout when flush takes too long (best-effort guarantee)', async () => {
      const deps = buildDeps({flushImpl: neverResolvingFlush, size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})

      const promise = scheduler.flushFinal({timeoutMs: 3000})
      await clock.tickAsync(3000)
      await promise

      expect(deps.flush.calledOnce).to.equal(true)
    })

    it('skips flush entirely when the queue is empty', async () => {
      const deps = buildDeps({size: 0})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})

      await scheduler.flushFinal({timeoutMs: 3000})

      expect(deps.flush.called, 'no flush on empty queue').to.equal(false)
    })

    it('skips flush when analytics is disabled', async () => {
      const deps = buildDeps({enabled: false, size: 100})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})

      await scheduler.flushFinal({timeoutMs: 3000})

      expect(deps.flush.called).to.equal(false)
    })

    it('joins an in-flight flush rather than starting a second', async () => {
      let releaseFlush!: () => void
      const slowFlush = (): Promise<void> =>
        new Promise<void>((resolve) => {
          releaseFlush = resolve
        })
      const deps = buildDeps({flushImpl: slowFlush, size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})
      scheduler.start()

      await clock.tickAsync(30_000)
      expect(deps.flush.callCount).to.equal(1)

      const finalPromise = scheduler.flushFinal({timeoutMs: 3000})
      releaseFlush()
      await finalPromise

      expect(deps.flush.callCount, 'final must join in-flight flush, not start a second').to.equal(1)
      scheduler.stop()
    })

    it('joins a concurrent flush that claimed the slot mid-pendingCount (race regression)', async () => {
      // Regression for the flushFinal double-send race:
      //   1. flushFinal enters, sees pendingFlush=undefined.
      //   2. flushFinal awaits pendingCount() (I/O).
      //   3. During that await, a competing trigger (setImmediate from
      //      notifyPushed, or a last interval tick) calls startFlush and
      //      sets pendingFlush.
      //   4. flushFinal resumes — without the double-check it would call
      //      startFlush again, overwrite the slot, and ship the same
      //      records twice.
      //
      // Reproducing the race deterministically requires forcing the
      // tryFlush trigger to claim the slot BETWEEN flushFinal's
      // pendingCount call and its post-await line. We do this by hooking
      // a manually-released gate into `deps.pendingCount` and calling
      // `tryFlush` (via the public threshold path) while flushFinal is
      // parked on that gate.
      let releaseFlush!: () => void
      const slowFlush = (): Promise<void> =>
        new Promise<void>((resolve) => {
          releaseFlush = resolve
        })
      const deps = buildDeps({flushImpl: slowFlush, size: 20})

      // Make pendingCount wait on a manual gate so the test can interleave
      // a competing trigger before flushFinal resumes.
      let releasePendingCount!: () => void
      const pendingGate = new Promise<void>((resolve) => {
        releasePendingCount = resolve
      })
      // First call (from flushFinal) waits on the gate; subsequent calls
      // (from tryFlush triggered by notifyPushed) resolve immediately so
      // the competing path can complete and claim pendingFlush.
      let pendingCallCount = 0
      deps.pendingCount = sinon.stub().callsFake(async () => {
        pendingCallCount += 1
        if (pendingCallCount === 1) await pendingGate
        return 5
      })
      const scheduler = new AnalyticsFlushScheduler({
        ...deps,
        intervalMs: 30_000,
        thresholdCount: 20,
      })

      // Step A: flushFinal enters and parks on pendingCount.
      const finalPromise = scheduler.flushFinal({timeoutMs: 3000})

      // Step B: trigger a competing tryFlush via the threshold path while
      // flushFinal is still parked. notifyPushed schedules setImmediate;
      // tickAsync(1) drains it and lets tryFlush call startFlush, which
      // synchronously claims pendingFlush.
      scheduler.notifyPushed()
      await clock.tickAsync(1)

      // Step C: now release flushFinal's pendingCount gate. flushFinal
      // resumes with pendingFlush ALREADY set by the competing tryFlush.
      // The double-check must catch this and join instead of overwriting.
      releasePendingCount()
      releaseFlush()
      await finalPromise

      expect(deps.flush.callCount, 'race regression: flushFinal must NOT start a second send').to.equal(1)
    })

    it('does NOT throw when the underlying flush rejects (analytics MUST NOT crash shutdown)', async () => {
      const deps = buildDeps({async flushImpl() { throw new Error('network boom'); }, size: 5})
      const scheduler = new AnalyticsFlushScheduler({...deps, intervalMs: 30_000})

      let threw = false
      try {
        const promise = scheduler.flushFinal({timeoutMs: 3000})
        await clock.tickAsync(1)
        await promise
      } catch {
        threw = true
      }

      expect(threw, 'flushFinal must swallow flush rejections').to.equal(false)
    })
  })
})
