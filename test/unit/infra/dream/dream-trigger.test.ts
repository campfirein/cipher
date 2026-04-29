import {expect} from 'chai'
import sinon from 'sinon'

import type {DreamState} from '../../../../src/server/infra/dream/dream-state-schema.js'

import {DreamTrigger} from '../../../../src/server/infra/dream/dream-trigger.js'

function makeState(overrides: Partial<DreamState> = {}): DreamState {
  return {
    curationsSinceDream: 5,
    lastDreamAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    lastDreamLogId: null,
    pendingMerges: [],
    staleSummaryPaths: [],
    totalDreams: 0,
    version: 1,
    ...overrides,
  }
}

function makeDeps(overrides: {
  lockAcquired?: boolean
  priorMtime?: number
  queueLength?: number
  state?: DreamState
} = {}) {
  const state = overrides.state ?? makeState()
  return {
    dreamLockService: {
      tryAcquire: sinon.stub().resolves(
        overrides.lockAcquired === false
          ? {acquired: false}
          : {acquired: true, priorMtime: overrides.priorMtime ?? 0},
      ),
    },
    dreamStateService: {
      read: sinon.stub().resolves(state),
    },
    getQueueLength: sinon.stub().returns(overrides.queueLength ?? 0),
  }
}

describe('DreamTrigger', () => {
  describe('tryStartDream', () => {
    it('should return eligible when all gates pass', async () => {
      const deps = makeDeps()
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.true
      if (result.eligible) {
        expect(result.priorMtime).to.equal(0)
      }
    })

    it('should fail when time gate fails (too recent)', async () => {
      const deps = makeDeps({
        state: makeState({lastDreamAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('recent')
      }
    })

    it('should fail when activity gate fails (not enough curations)', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 1}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('activity')
      }
    })

    it('should bypass activity gate when stale-summary queue has work', async () => {
      // ENG-2485: deferred summary cascade lives in staleSummaryPaths. If a
      // low-activity project (1-2 curates) accumulates queued paths and the
      // activity gate kept blocking, _index.md regeneration would never run.
      const deps = makeDeps({
        state: makeState({
          curationsSinceDream: 1,
          staleSummaryPaths: [{enqueuedAt: Date.now(), path: 'auth/jwt.md'}],
        }),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.true
    })

    it('should still fail activity gate when both curations AND queue are empty', async () => {
      // Negative case for the bypass: empty queue + low activity means the
      // activity gate should still block (nothing to drain, no work to do).
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 1, staleSummaryPaths: []}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('activity')
      }
    })

    it('should fail when queue is not empty', async () => {
      const deps = makeDeps({queueLength: 3})
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('Queue')
      }
    })

    it('should fail when lock is held', async () => {
      const deps = makeDeps({lockAcquired: false})
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('Lock')
      }
    })

    // ── Force mode ─────────────────────────────────────────────────────────

    it('should skip time gate when force=true', async () => {
      const deps = makeDeps({
        state: makeState({lastDreamAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project', true)
      expect(result.eligible).to.be.true
    })

    it('should skip activity gate when force=true', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 0}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project', true)
      expect(result.eligible).to.be.true
    })

    it('should skip queue gate when force=true', async () => {
      const deps = makeDeps({queueLength: 3})
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project', true)
      expect(result.eligible).to.be.true
    })

    it('should NOT skip lock gate even when force=true', async () => {
      const deps = makeDeps({lockAcquired: false})
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project', true)
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('Lock')
      }
    })

    // ── First dream ────────────────────────────────────────────────────────

    it('should fail on first dream (no state) due to activity gate', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 0, lastDreamAt: null}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('activity')
      }
    })

    it('should pass first dream with force=true', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 0, lastDreamAt: null}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.tryStartDream('/project', true)
      expect(result.eligible).to.be.true
    })

    // ── Gate order ─────────────────────────────────────────────────────────

    it('should not check queue or lock when time fails', async () => {
      const deps = makeDeps({
        state: makeState({lastDreamAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()}),
      })
      const trigger = new DreamTrigger(deps)

      await trigger.tryStartDream('/project')
      expect(deps.getQueueLength.called).to.be.false
      expect(deps.dreamLockService.tryAcquire.called).to.be.false
    })

    it('should not check queue or lock when activity fails', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 1}),
      })
      const trigger = new DreamTrigger(deps)

      await trigger.tryStartDream('/project')
      expect(deps.getQueueLength.called).to.be.false
      expect(deps.dreamLockService.tryAcquire.called).to.be.false
    })

    it('should not check lock when queue fails', async () => {
      const deps = makeDeps({queueLength: 3})
      const trigger = new DreamTrigger(deps)

      await trigger.tryStartDream('/project')
      expect(deps.dreamLockService.tryAcquire.called).to.be.false
    })

    // ── Custom thresholds ──────────────────────────────────────────────────

    it('should respect custom minHours', async () => {
      const deps = makeDeps({
        state: makeState({lastDreamAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()}),
      })
      const trigger = new DreamTrigger(deps, {minHours: 4})

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.true
    })

    it('should respect custom minCurations', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 1}),
      })
      const trigger = new DreamTrigger(deps, {minCurations: 1})

      const result = await trigger.tryStartDream('/project')
      expect(result.eligible).to.be.true
    })
  })

  describe('checkEligibility', () => {
    it('should return eligible when gates 1-3 pass', async () => {
      const deps = makeDeps()
      const trigger = new DreamTrigger(deps)

      const result = await trigger.checkEligibility('/project')
      expect(result.eligible).to.be.true
    })

    it('should NOT call lock service (gate 4)', async () => {
      const deps = makeDeps()
      const trigger = new DreamTrigger(deps)

      await trigger.checkEligibility('/project')
      expect(deps.dreamLockService.tryAcquire.called).to.be.false
    })

    it('should fail when time gate fails', async () => {
      const deps = makeDeps({
        state: makeState({lastDreamAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.checkEligibility('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('recent')
      }
    })

    it('should fail when activity gate fails', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 1}),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.checkEligibility('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('activity')
      }
    })

    it('should bypass activity gate when stale-summary queue has work', async () => {
      // Symmetry with the tryStartDream bypass test — both methods delegate
      // to checkGates1to3, so a future refactor of the shared path must keep
      // this invariant on both call sites.
      const deps = makeDeps({
        state: makeState({
          curationsSinceDream: 1,
          staleSummaryPaths: [{enqueuedAt: Date.now(), path: 'auth/jwt.md'}],
        }),
      })
      const trigger = new DreamTrigger(deps)

      const result = await trigger.checkEligibility('/project')
      expect(result.eligible).to.be.true
    })

    it('should fail when queue is not empty', async () => {
      const deps = makeDeps({queueLength: 3})
      const trigger = new DreamTrigger(deps)

      const result = await trigger.checkEligibility('/project')
      expect(result.eligible).to.be.false
      if (!result.eligible) {
        expect(result.reason).to.include('Queue')
      }
    })

    it('should respect custom thresholds', async () => {
      const deps = makeDeps({
        state: makeState({curationsSinceDream: 1, lastDreamAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()}),
      })
      const trigger = new DreamTrigger(deps, {minCurations: 1, minHours: 4})

      const result = await trigger.checkEligibility('/project')
      expect(result.eligible).to.be.true
    })
  })
})
