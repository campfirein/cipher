/**
 * Unit tests for the harness smoke script step functions.
 *
 * Each step is tested in isolation against an inMemory stack. Steps
 * that depend on prior state (e.g., step 3 needs v1 from step 2)
 * have their preconditions set up directly in the test.
 *
 * The full sequential run is also tested to verify end-to-end
 * completion under 30s.
 */

import {expect} from 'chai'

import type {SmokeContext} from '../../../scripts/harness-smoke.js'

import {
  cleanupSmokeContext,
  createSmokeContext,
  runSmoke,
  SmokeAssertionError,
  step01EnableAndStatus,
  step02BootstrapAndCurate,
  step03InspectV1,
  step04RefinementToV2,
  step05SessionBanner,
  step06DiffV1V2,
  step07CurateWithV2,
  step08FeedbackBad,
  step09HeuristicDrops,
  step10PinV1,
  step11Baseline,
  step12DisableHarness,
  STEPS,
} from '../../../scripts/harness-smoke.js'

describe('harness-smoke step functions', function () {
  this.timeout(30_000)

  let ctx: SmokeContext

  beforeEach(async () => {
    ctx = await createSmokeContext({llmMode: 'stub'})
  })

  afterEach(() => {
    cleanupSmokeContext(ctx)
  })

  describe('step 1 — enable and status', () => {
    it('passes with enabled config and empty store', async () => {
      await step01EnableAndStatus(ctx)
    })
  })

  describe('step 2 — bootstrap and curate', () => {
    it('creates v1 and records 3 outcomes', async () => {
      await step02BootstrapAndCurate(ctx)
      expect(ctx.state.v1).to.not.equal(undefined)
      expect(ctx.state.v1?.version).to.equal(1)
    })
  })

  describe('step 3 — inspect v1', () => {
    it('fails without v1 in state', async () => {
      try {
        await step03InspectV1(ctx)
        expect.fail('should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(SmokeAssertionError)
      }
    })

    it('passes after step 2 populates v1', async () => {
      await step02BootstrapAndCurate(ctx)
      await step03InspectV1(ctx)
    })
  })

  describe('step 4 — refinement to v2', () => {
    it('creates v2 via synthesizer', async () => {
      await step02BootstrapAndCurate(ctx)
      await step04RefinementToV2(ctx)
      expect(ctx.state.v2).to.not.equal(undefined)
      expect(ctx.state.v2?.version).to.equal(2)
      expect(ctx.state.refinementEvents).to.have.length(1)
    })
  })

  describe('step 5 — session banner', () => {
    it('prints banner after refinement', async () => {
      await step02BootstrapAndCurate(ctx)
      await step04RefinementToV2(ctx)
      await step05SessionBanner(ctx)
      expect(ctx.bannerLines).to.have.length(1)
      expect(ctx.bannerLines[0]).to.match(/harness updated/)
    })
  })

  describe('step 6 — diff v1 v2', () => {
    it('shows diff between versions', async () => {
      await step02BootstrapAndCurate(ctx)
      await step04RefinementToV2(ctx)
      await step06DiffV1V2(ctx)
    })
  })

  describe('step 7 — curate with v2', () => {
    it('loads and executes v2', async () => {
      await step02BootstrapAndCurate(ctx)
      await step04RefinementToV2(ctx)
      await step07CurateWithV2(ctx)
    })
  })

  describe('step 8 — feedback bad', () => {
    it('inserts 3 synthetic failures', async () => {
      await step08FeedbackBad(ctx)
    })
  })

  describe('step 9 — heuristic drops', () => {
    it('H drops after synthetics from step 8', async () => {
      await step08FeedbackBad(ctx)
      await step09HeuristicDrops(ctx)
    })
  })

  describe('step 10 — pin v1', () => {
    it('loadHarness returns pinned v1', async () => {
      await step02BootstrapAndCurate(ctx)
      await step10PinV1(ctx)
    })
  })

  describe('step 11 — baseline', () => {
    it('runs dual-arm replay', async () => {
      await step02BootstrapAndCurate(ctx)
      await step04RefinementToV2(ctx)
      await step11Baseline(ctx)
    })
  })

  describe('step 12 — disable harness', () => {
    it('loadHarness returns loaded=false', async () => {
      await step12DisableHarness(ctx)
    })
  })

  describe('full sequential run', () => {
    it('all 12 steps pass in under 30s', async () => {
      const results = await runSmoke(ctx)
      const allPassed = results.every((r) => r.passed)
      const failDetails = results
        .filter((r) => !r.passed)
        .map((r) => `${r.stepNumber}: ${r.details}`)
        .join(', ')
      expect(allPassed, `failed steps: ${failDetails}`).to.equal(true)
      expect(results).to.have.length(STEPS.length)
    })
  })
})
