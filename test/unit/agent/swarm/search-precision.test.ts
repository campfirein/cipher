import {expect} from 'chai'
import MiniSearch from 'minisearch'

import type {NormalizedResult} from '../../../../src/agent/infra/swarm/search-precision.js'

import {
  applyGapRatio,
  applyScoreFloor,
  filterStopWords,
  searchWithPrecision,
} from '../../../../src/agent/infra/swarm/search-precision.js'

function buildTestIndex(docs: Array<{content: string; id: string; title: string}>): MiniSearch<{content: string; id: string; title: string}> {
  const index = new MiniSearch({
    fields: ['title', 'content'],
    idField: 'id',
    storeFields: ['title'],
  })

  index.addAll(docs)

  return index
}

describe('search-precision', () => {
  describe('filterStopWords()', () => {
    it('preserves significant terms', () => {
      expect(filterStopWords('typescript generics patterns')).to.equal('typescript generics patterns')
    })

    it('removes common stop words', () => {
      const result = filterStopWords('what is the best approach for authentication')
      expect(result).to.include('best')
      expect(result).to.include('approach')
      expect(result).to.include('authentication')
      expect(result).not.to.include(' the ')
    })

    it('returns original query when all tokens are stop words', () => {
      // "is the a" are all stop words — should return original, not empty
      const result = filterStopWords('is the a')
      expect(result).to.equal('is the a')
    })

    it('handles empty string', () => {
      expect(filterStopWords('')).to.equal('')
    })
  })

  describe('applyScoreFloor()', () => {
    const results: NormalizedResult[] = [
      {id: '1', normalizedScore: 0.8, queryTerms: [], rawScore: 4},
      {id: '2', normalizedScore: 0.5, queryTerms: [], rawScore: 1},
      {id: '3', normalizedScore: 0.2, queryTerms: [], rawScore: 0.25},
    ]

    it('passes through when top score is above threshold', () => {
      const filtered = applyScoreFloor(results, 0.3)
      expect(filtered).to.have.length(3)
    })

    it('returns empty when top score is below threshold', () => {
      const lowResults: NormalizedResult[] = [
        {id: '1', normalizedScore: 0.25, queryTerms: [], rawScore: 0.33},
        {id: '2', normalizedScore: 0.1, queryTerms: [], rawScore: 0.11},
      ]
      const filtered = applyScoreFloor(lowResults, 0.3)
      expect(filtered).to.have.length(0)
    })

    it('returns empty for empty input', () => {
      expect(applyScoreFloor([], 0.3)).to.have.length(0)
    })
  })

  describe('applyGapRatio()', () => {
    it('keeps results above gap ratio threshold', () => {
      // Top score 0.8, gap ratio 0.75 → floor = 0.6
      const results: NormalizedResult[] = [
        {id: '1', normalizedScore: 0.8, queryTerms: [], rawScore: 4},
        {id: '2', normalizedScore: 0.7, queryTerms: [], rawScore: 2.33},
        {id: '3', normalizedScore: 0.3, queryTerms: [], rawScore: 0.43},
      ]
      const filtered = applyGapRatio(results, 0.75)
      expect(filtered).to.have.length(2)
      expect(filtered[0].id).to.equal('1')
      expect(filtered[1].id).to.equal('2')
    })

    it('returns empty for empty input', () => {
      expect(applyGapRatio([], 0.75)).to.have.length(0)
    })

    it('keeps all when scores are close', () => {
      const results: NormalizedResult[] = [
        {id: '1', normalizedScore: 0.8, queryTerms: [], rawScore: 4},
        {id: '2', normalizedScore: 0.75, queryTerms: [], rawScore: 3},
        {id: '3', normalizedScore: 0.65, queryTerms: [], rawScore: 1.86},
      ]
      const filtered = applyGapRatio(results, 0.75)
      expect(filtered).to.have.length(3)
    })

    it('handles unsorted input by sorting first', () => {
      // Input is NOT sorted descending — implementation should sort or assert
      const results: NormalizedResult[] = [
        {id: '2', normalizedScore: 0.3, queryTerms: [], rawScore: 0.43},
        {id: '1', normalizedScore: 0.8, queryTerms: [], rawScore: 4},
        {id: '3', normalizedScore: 0.1, queryTerms: [], rawScore: 0.11},
      ]
      const filtered = applyGapRatio(results, 0.75)
      // Should still use 0.8 as top → floor = 0.6 → only id '1' passes
      expect(filtered).to.have.length(1)
      expect(filtered[0].id).to.equal('1')
    })
  })

  describe('searchWithPrecision()', () => {
    it('returns normalized results from MiniSearch', () => {
      const index = buildTestIndex([
        {content: 'TypeScript generics allow reusable typed code', id: '1', title: 'TypeScript Generics'},
        {content: 'React hooks for managing component state', id: '2', title: 'React Hooks'},
      ])

      const results = searchWithPrecision(index, 'typescript generics')
      expect(results.length).to.be.greaterThan(0)
      expect(results[0].normalizedScore).to.be.greaterThan(0)
      expect(results[0].normalizedScore).to.be.at.most(1)
    })

    it('uses AND-first for multi-word queries', () => {
      const index = buildTestIndex([
        {content: 'TypeScript generics allow reusable typed code', id: '1', title: 'TypeScript Generics'},
        {content: 'Python generics are also useful for typing', id: '2', title: 'Python Generics'},
        {content: 'TypeScript classes provide OOP patterns', id: '3', title: 'TypeScript Classes'},
      ])

      // "TypeScript generics" should match doc 1 (both terms) more than docs 2 or 3 (single term)
      const results = searchWithPrecision(index, 'TypeScript generics')
      expect(results.length).to.be.greaterThan(0)
      expect(String(results[0].id)).to.equal('1')
    })

    it('falls back to OR but rejects single-term matches for 2-word queries', () => {
      const index = buildTestIndex([
        {content: 'TypeScript generics allow reusable typed code', id: '1', title: 'TypeScript Generics'},
        {content: 'React hooks for managing state', id: '2', title: 'React Hooks'},
      ])

      const results = searchWithPrecision(index, 'typescript zebra')
      expect(results).to.have.length(0)
    })

    it('OR fallback keeps results when enough terms match for 3+ word queries', () => {
      const index = buildTestIndex([
        {content: 'TypeScript generics allow reusable typed code patterns', id: '1', title: 'TypeScript Generics'},
        {content: 'React hooks for managing state', id: '2', title: 'React Hooks'},
      ])

      const results = searchWithPrecision(index, 'typescript generics zebra')
      expect(results.length).to.be.greaterThan(0)
      expect(String(results[0].id)).to.equal('1')
    })

    it('OR fallback returns empty when no doc matches enough query terms', () => {
      const index = buildTestIndex([
        {content: 'error handling patterns for robust management of system failures', id: '1', title: 'Error Handling Management'},
        {content: 'session management for web applications with cookies', id: '2', title: 'Session Management'},
      ])

      const results = searchWithPrecision(index, 'project management')
      expect(results).to.have.length(0)
    })

    it('OR fallback keeps results matching majority of query terms', () => {
      const index = buildTestIndex([
        {content: 'project planning and management for agile teams', id: '1', title: 'Project Planning'},
        {content: 'session management for web applications', id: '2', title: 'Session Management'},
      ])

      const results = searchWithPrecision(index, 'project management timeline')
      expect(results.length).to.be.greaterThan(0)
      expect(String(results[0].id)).to.equal('1')
      const sessionResult = results.find((r) => String(r.id) === '2')
      expect(sessionResult).to.be.undefined
    })

    it('applies score floor — returns empty when all scores weak', () => {
      const index = buildTestIndex([
        {content: 'Completely unrelated document about cooking pasta', id: '1', title: 'Pasta Recipe'},
        {content: 'Another document about gardening tips', id: '2', title: 'Gardening Tips'},
      ])

      // "quantum computing" won't match well
      const results = searchWithPrecision(index, 'quantum computing', {scoreFloor: 0.3})
      expect(results).to.have.length(0)
    })

    it('applies gap ratio — drops tail results', () => {
      const index = buildTestIndex([
        {content: 'Project management with agile methodologies for teams', id: '1', title: 'Project Management'},
        {content: 'Session management using JWT tokens for authentication', id: '2', title: 'Session Management'},
        {content: 'Advanced project planning and estimation', id: '3', title: 'Project Planning'},
      ])

      // "project management" with AND-first should strongly prefer doc 1
      const results = searchWithPrecision(index, 'project management', {gapRatio: 0.75})

      // Doc 1 should match well; doc 2 matches only "management"
      // With gap ratio, doc 2 should be filtered if its score is < 75% of doc 1
      if (results.length > 0) {
        const topScore = results[0].normalizedScore
        for (const r of results) {
          expect(r.normalizedScore).to.be.at.least(topScore * 0.75)
        }
      }
    })

    it('respects maxResults', () => {
      const index = buildTestIndex([
        {content: 'TypeScript generics', id: '1', title: 'TS Generics'},
        {content: 'TypeScript decorators', id: '2', title: 'TS Decorators'},
        {content: 'TypeScript enums', id: '3', title: 'TS Enums'},
        {content: 'TypeScript types', id: '4', title: 'TS Types'},
        {content: 'TypeScript utility types', id: '5', title: 'TS Utility'},
      ])

      const results = searchWithPrecision(index, 'TypeScript', {maxResults: 2})
      expect(results.length).to.be.at.most(2)
    })

    it('preserves fuzzy and prefix options', () => {
      const index = buildTestIndex([
        {content: 'Authentication tokens for API access', id: '1', title: 'Auth Tokens'},
      ])

      // With prefix: true, "auth" should match "authentication"
      const results = searchWithPrecision(index, 'auth', {fuzzy: 0.2, prefix: true})
      expect(results.length).to.be.greaterThan(0)
    })
  })
})
