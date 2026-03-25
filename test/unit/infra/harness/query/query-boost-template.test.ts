
import {expect} from 'chai'

import {
  applyBoostAdjustments,
  type BoostAdjustments,
  computeBoostAdjustments,
} from '../../../../../src/server/infra/harness/query/query-boost-template.js'

function makeResult(overrides: Partial<{backlinkCount: number; score: number; symbolPath: string; title: string}> = {}) {
  return {
    excerpt: 'some excerpt',
    path: '/some/path',
    score: overrides.score ?? 0.5,
    symbolPath: overrides.symbolPath ?? 'domain/topic/subtopic',
    title: overrides.title ?? 'Some Title',
    ...(overrides.backlinkCount === undefined ? {} : {backlinkCount: overrides.backlinkCount}),
  }
}

describe('query-boost-template', () => {
  describe('computeBoostAdjustments', () => {
    it('returns defaults for invalid YAML', () => {
      const adj = computeBoostAdjustments(':::bad yaml:::')
      expect(adj.domainMatchBonus).to.equal(0)
      expect(adj.titleMatchBonus).to.equal(0)
      expect(adj.crossReferenceBonus).to.equal(0)
    })
  })

  describe('applyBoostAdjustments', () => {
    it('applies domain match bonus when result path matches domain hint', () => {
      const results = [makeResult({score: 0.5, symbolPath: 'auth/login/handler'})]
      const adjustments: BoostAdjustments = {crossReferenceBonus: 0, domainMatchBonus: 0.2, titleMatchBonus: 0}

      const adjusted = applyBoostAdjustments(results, adjustments, 'login', ['auth'])
      expect(adjusted[0].score).to.be.closeTo(0.7, 0.001)
      // Original not mutated
      expect(results[0].score).to.equal(0.5)
    })

    it('applies title match bonus when title contains query terms', () => {
      const results = [makeResult({score: 0.5, title: 'Authentication Guide'})]
      const adjustments: BoostAdjustments = {crossReferenceBonus: 0, domainMatchBonus: 0, titleMatchBonus: 0.15}

      const adjusted = applyBoostAdjustments(results, adjustments, 'authentication', [])
      expect(adjusted[0].score).to.be.closeTo(0.65, 0.001)
    })

    it('applies cross-reference bonus based on backlinkCount', () => {
      const results = [makeResult({backlinkCount: 3, score: 0.5})]
      const adjustments: BoostAdjustments = {crossReferenceBonus: 0.05, domainMatchBonus: 0, titleMatchBonus: 0}

      const adjusted = applyBoostAdjustments(results, adjustments, 'query', [])
      expect(adjusted[0].score).to.be.closeTo(0.65, 0.001)
    })

    it('returns results unchanged with zero adjustments (default)', () => {
      const results = [
        makeResult({score: 0.8, title: 'A'}),
        makeResult({score: 0.5, title: 'B'}),
      ]
      const adjustments: BoostAdjustments = {crossReferenceBonus: 0, domainMatchBonus: 0, titleMatchBonus: 0}

      const adjusted = applyBoostAdjustments(results, adjustments, 'test', ['domain'])
      expect(adjusted[0].score).to.equal(0.8)
      expect(adjusted[1].score).to.equal(0.5)
    })

    it('re-sorts results after adjustment', () => {
      const results = [
        makeResult({score: 0.6, symbolPath: 'other/topic', title: 'First'}),
        makeResult({score: 0.3, symbolPath: 'auth/login', title: 'Second'}),
      ]
      const adjustments: BoostAdjustments = {crossReferenceBonus: 0, domainMatchBonus: 0.4, titleMatchBonus: 0}

      const adjusted = applyBoostAdjustments(results, adjustments, 'query', ['auth'])
      expect(adjusted[0].title).to.equal('Second')
      expect(adjusted[0].score).to.be.closeTo(0.7, 0.001)
      expect(adjusted[1].title).to.equal('First')
      expect(adjusted[1].score).to.be.closeTo(0.6, 0.001)
    })

    it('clamps adjusted scores to [0, 0.9999]', () => {
      const results = [makeResult({score: 0.8, symbolPath: 'auth/login'})]
      const adjustments: BoostAdjustments = {crossReferenceBonus: 0, domainMatchBonus: 0.5, titleMatchBonus: 0}

      const adjusted = applyBoostAdjustments(results, adjustments, 'query', ['auth'])
      expect(adjusted[0].score).to.equal(0.9999)
    })
  })
})
