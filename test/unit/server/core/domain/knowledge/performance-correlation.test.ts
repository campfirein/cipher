import {expect} from 'chai'

import type {NormalizedPerformanceLogEntry} from '../../../../../../src/server/core/domain/experience/experience-types.js'

import {
  computeDomainFactors,
  computePerformanceFactors,
  lookupParentFactor,
} from '../../../../../../src/server/core/domain/knowledge/performance-correlation.js'

function makeEntry(
  overrides: Partial<NormalizedPerformanceLogEntry>,
): NormalizedPerformanceLogEntry {
  return {
    curationId: 1,
    domain: 'auth',
    insightsActive: ['auth/context.md'],
    score: 0.5,
    summary: 'summary',
    ts: '2026-03-31T00:00:00.000Z',
    ...overrides,
  }
}

describe('performance-correlation', () => {
  describe('computePerformanceFactors()', () => {
    it('returns an empty map when fewer than five entries have non-empty insightsActive', () => {
      const log = [
        makeEntry({curationId: 1}),
        makeEntry({curationId: 2}),
        makeEntry({curationId: 3}),
        makeEntry({curationId: 4, insightsActive: []}),
      ]

      expect(computePerformanceFactors(log).size).to.equal(0)
      expect(computeDomainFactors(log).size).to.equal(0)
    })

    it('activates once exactly five entries have non-empty insightsActive', () => {
      const log = [
        makeEntry({curationId: 1, insightsActive: ['auth/good.md'], score: 0.9}),
        makeEntry({curationId: 2, insightsActive: ['auth/good.md'], score: 0.88}),
        makeEntry({curationId: 3, insightsActive: ['auth/good.md'], score: 0.86}),
        makeEntry({curationId: 4, insightsActive: ['auth/bad.md'], score: 0.35}),
        makeEntry({curationId: 5, insightsActive: ['auth/bad.md'], score: 0.3}),
      ]

      const factors = computePerformanceFactors(log)

      expect(factors.size).to.be.greaterThan(0)
      expect(factors.get('auth/good.md') ?? 0).to.be.greaterThan(0)
    })

    it('builds domain baselines from the full log, not only insight-tagged entries', () => {
      const log = [
        makeEntry({curationId: 1, insightsActive: ['auth/good.md'], score: 0.9}),
        makeEntry({curationId: 2, insightsActive: ['auth/good.md'], score: 0.9}),
        makeEntry({curationId: 3, insightsActive: ['auth/good.md'], score: 0.9}),
        makeEntry({curationId: 4, insightsActive: ['auth/good.md'], score: 0.9}),
        makeEntry({curationId: 5, insightsActive: ['auth/good.md'], score: 0.9}),
        makeEntry({curationId: 6, insightsActive: [], score: 0.1}),
        makeEntry({curationId: 7, insightsActive: [], score: 0.1}),
        makeEntry({curationId: 8, insightsActive: [], score: 0.1}),
        makeEntry({curationId: 9, insightsActive: [], score: 0.1}),
        makeEntry({curationId: 10, insightsActive: [], score: 0.1}),
      ]

      const pathFactors = computePerformanceFactors(log)
      const domainFactors = computeDomainFactors(log)

      expect(pathFactors.get('auth/good.md') ?? 0).to.be.greaterThan(0)
      expect(domainFactors.get('auth') ?? 0).to.be.greaterThan(0)
    })

    it('gives positive factors to paths correlated with above-average scores', () => {
      const log = [
        makeEntry({curationId: 1, insightsActive: ['auth/good.md'], score: 0.9}),
        makeEntry({curationId: 2, insightsActive: ['auth/good.md'], score: 0.88}),
        makeEntry({curationId: 3, insightsActive: ['auth/good.md'], score: 0.86}),
        makeEntry({curationId: 4, insightsActive: ['auth/bad.md'], score: 0.35}),
        makeEntry({curationId: 5, insightsActive: ['auth/bad.md'], score: 0.3}),
      ]

      const factors = computePerformanceFactors(log)

      expect(factors.get('auth/good.md') ?? 0).to.be.greaterThan(0)
      expect(factors.get('auth/bad.md') ?? 0).to.be.lessThan(0)
    })

    it('bounds path and domain factors to +/- 0.15', () => {
      const log = [
        makeEntry({curationId: 1, domain: 'auth', insightsActive: ['auth/good.md'], score: 1}),
        makeEntry({curationId: 2, domain: 'auth', insightsActive: ['auth/good.md'], score: 1}),
        makeEntry({curationId: 3, domain: 'auth', insightsActive: ['auth/good.md'], score: 1}),
        makeEntry({curationId: 4, domain: 'build', insightsActive: ['build/bad.md'], score: 0}),
        makeEntry({curationId: 5, domain: 'build', insightsActive: ['build/bad.md'], score: 0}),
        makeEntry({curationId: 6, domain: 'build', insightsActive: ['build/bad.md'], score: 0}),
      ]

      const pathFactors = computePerformanceFactors(log)
      const domainFactors = computeDomainFactors(log)

      for (const factor of [...pathFactors.values(), ...domainFactors.values()]) {
        expect(factor).to.be.at.least(-0.15)
        expect(factor).to.be.at.most(0.15)
      }
    })
  })

  describe('lookupParentFactor()', () => {
    it('cascades exact path, _index.md, context.md, domain fallback, then zero', () => {
      const pathFactors = new Map<string, number>([
        ['auth/contextual/context.md', -0.04],
        ['auth/exact', 0.11],
        ['auth/indexed/_index.md', 0.08],
      ])
      const domainFactors = new Map<string, number>([['auth', 0.02]])

      expect(lookupParentFactor('auth/exact', pathFactors, domainFactors)).to.equal(0.11)
      expect(lookupParentFactor('auth/indexed', pathFactors, domainFactors)).to.equal(0.08)
      expect(lookupParentFactor('auth/contextual', pathFactors, domainFactors)).to.equal(-0.04)
      expect(lookupParentFactor('auth/missing', pathFactors, domainFactors)).to.equal(0.02)
      expect(lookupParentFactor('other/missing', pathFactors, new Map())).to.equal(0)
    })
  })
})
