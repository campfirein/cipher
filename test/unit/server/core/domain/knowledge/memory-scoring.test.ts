import {expect} from 'chai'

import {
  applyDecay,
  compoundScore,
  determineTier,
  recordAccessHit,
  recordAccessHits,
  recordConsolidation,
  recordCurateUpdate,
  W_IMPORTANCE,
  W_RECENCY,
  W_RELEVANCE,
} from '../../../../../../src/server/core/domain/knowledge/memory-scoring.js'

// ---------------------------------------------------------------------------
// compoundScore
// ---------------------------------------------------------------------------

describe('memory-scoring', () => {
  describe('compoundScore()', () => {
    it('reflects BM25 relevance via W_RELEVANCE', () => {
      const low = compoundScore(0.2, 50, 1, 'draft')
      const high = compoundScore(0.8, 50, 1, 'draft')
      expect(high).to.be.greaterThan(low)
    })

    it('higher importance produces a higher score (W_IMPORTANCE > 0)', () => {
      // Only meaningful if W_IMPORTANCE is non-zero
      expect(W_IMPORTANCE).to.be.greaterThan(0, 'W_IMPORTANCE must be non-zero for importance to influence ranking')

      const low = compoundScore(0.5, 10, 1, 'draft')
      const high = compoundScore(0.5, 90, 1, 'draft')
      expect(high).to.be.greaterThan(low)
    })

    it('higher recency produces a higher score (W_RECENCY > 0)', () => {
      expect(W_RECENCY).to.be.greaterThan(0, 'W_RECENCY must be non-zero for recency to influence ranking')

      const stale = compoundScore(0.5, 50, 0, 'draft')
      const fresh = compoundScore(0.5, 50, 1, 'draft')
      expect(fresh).to.be.greaterThan(stale)
    })

    it('score is zero when all inputs are zero', () => {
      expect(compoundScore(0, 0, 0, 'draft')).to.equal(0)
    })

    it('W_RELEVANCE + W_IMPORTANCE + W_RECENCY are the active weights', () => {
      // Verify the weight constants are what we expect so a future change is caught
      expect(W_RELEVANCE).to.equal(1)
      expect(W_IMPORTANCE).to.equal(0.15)
      expect(W_RECENCY).to.equal(0.05)
    })

    it('importance=100 and recency=1 add the expected bonus on top of BM25', () => {
      const bm25Only = compoundScore(0.5, 0, 0, 'draft')
      const withBonus = compoundScore(0.5, 100, 1, 'draft')
      // Difference should equal W_IMPORTANCE * 1.0 + W_RECENCY * 1.0
      expect(withBonus - bm25Only).to.be.closeTo(W_IMPORTANCE + W_RECENCY, 1e-9)
    })
  })

  // -------------------------------------------------------------------------
  // determineTier
  // -------------------------------------------------------------------------

  describe('determineTier()', () => {
    it('promotes draft → validated at PROMOTE_TO_VALIDATED threshold', () => {
      expect(determineTier(65, 'draft')).to.equal('validated')
      expect(determineTier(64, 'draft')).to.equal('draft')
    })

    it('promotes validated → core at PROMOTE_TO_CORE threshold', () => {
      expect(determineTier(85, 'validated')).to.equal('core')
      expect(determineTier(84, 'validated')).to.equal('validated')
    })

    it('does not promote validated → core without passing threshold', () => {
      expect(determineTier(70, 'validated')).to.equal('validated')
    })

    it('demotes core → validated below DEMOTE_FROM_CORE (hysteresis)', () => {
      expect(determineTier(59, 'core')).to.equal('validated')
      expect(determineTier(60, 'core')).to.equal('core')
    })

    it('demotes validated → draft below DEMOTE_FROM_VALIDATED (hysteresis)', () => {
      expect(determineTier(34, 'validated')).to.equal('draft')
      expect(determineTier(35, 'validated')).to.equal('validated')
    })
  })

  // -------------------------------------------------------------------------
  // applyDecay
  // -------------------------------------------------------------------------

  describe('applyDecay()', () => {
    it('returns unchanged scoring when days <= 0', () => {
      const scoring = {importance: 80, recency: 1}
      expect(applyDecay(scoring, 0)).to.deep.equal(scoring)
      expect(applyDecay(scoring, -1)).to.deep.equal(scoring)
    })

    it('reduces recency and importance over time', () => {
      const scoring = {importance: 80, recency: 1}
      const decayed = applyDecay(scoring, 30)
      expect(decayed.recency).to.be.lessThan(1)
      expect(decayed.importance).to.be.lessThan(80)
    })

    it('does not mutate the original scoring', () => {
      const scoring = {importance: 80, recency: 1}
      applyDecay(scoring, 30)
      expect(scoring.importance).to.equal(80)
    })
  })

  // -------------------------------------------------------------------------
  // recordAccessHit / recordAccessHits
  // -------------------------------------------------------------------------

  describe('recordAccessHit()', () => {
    it('increments accessCount by 1', () => {
      const result = recordAccessHit({accessCount: 2, importance: 50})
      expect(result.accessCount).to.equal(3)
    })

    it('adds ACCESS_IMPORTANCE_BONUS to importance', () => {
      const result = recordAccessHit({accessCount: 0, importance: 50})
      expect(result.importance).to.be.greaterThan(50)
    })

    it('caps importance at 100', () => {
      const result = recordAccessHit({accessCount: 0, importance: 99})
      expect(result.importance).to.equal(100)
    })
  })

  describe('recordAccessHits()', () => {
    it('returns unchanged scoring when hitCount <= 0', () => {
      const scoring = {accessCount: 1, importance: 50}
      expect(recordAccessHits(scoring, 0)).to.deep.equal(scoring)
      expect(recordAccessHits(scoring, -1)).to.deep.equal(scoring)
    })

    it('applies multiple hits in one call', () => {
      const result = recordAccessHits({accessCount: 0, importance: 50}, 3)
      expect(result.accessCount).to.equal(3)
    })
  })

  // -------------------------------------------------------------------------
  // recordCurateUpdate
  // -------------------------------------------------------------------------

  describe('recordCurateUpdate()', () => {
    it('increments updateCount', () => {
      const result = recordCurateUpdate({importance: 50, updateCount: 1})
      expect(result.updateCount).to.equal(2)
    })

    it('resets recency to 1', () => {
      const result = recordCurateUpdate({importance: 50, recency: 0.3})
      expect(result.recency).to.equal(1)
    })

    it('adds UPDATE_IMPORTANCE_BONUS to importance', () => {
      const result = recordCurateUpdate({importance: 60, updateCount: 0})
      expect(result.importance).to.be.greaterThan(60)
    })
  })

  // -------------------------------------------------------------------------
  // recordConsolidation
  // -------------------------------------------------------------------------

  describe('recordConsolidation()', () => {
    it('preserves importance, recency, and updateCount', () => {
      const result = recordConsolidation({importance: 70, recency: 0.4, updateCount: 3})
      expect(result.importance).to.equal(70)
      expect(result.recency).to.equal(0.4)
      expect(result.updateCount).to.equal(3)
    })

    it('updates updatedAt', () => {
      const before = Date.now()
      const result = recordConsolidation({updatedAt: '2024-01-01T00:00:00.000Z'})
      expect(new Date(result.updatedAt!).getTime()).to.be.greaterThanOrEqual(before)
    })
  })
})
