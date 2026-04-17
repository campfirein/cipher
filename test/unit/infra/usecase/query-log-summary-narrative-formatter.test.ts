import {expect} from 'chai'

import type {QueryLogSummary} from '../../../../src/server/core/interfaces/usecase/i-query-log-summary-use-case.js'

import {formatQueryLogSummaryNarrative} from '../../../../src/server/infra/usecase/query-log-summary-narrative-formatter.js'

// ============================================================================
// Fixture helpers
// ============================================================================

function makeZeroSummary(overrides: Partial<QueryLogSummary> = {}): QueryLogSummary {
  return {
    byStatus: {cancelled: 0, completed: 0, error: 0},
    byTier: {tier0: 0, tier1: 0, tier2: 0, tier3: 0, tier4: 0, unknown: 0},
    cacheHitRate: 0,
    coverageRate: 0,
    knowledgeGaps: [],
    period: {from: 0, to: 0},
    queriesWithoutMatches: 0,
    responseTime: {avgMs: 0, p50Ms: 0, p95Ms: 0},
    topRecalledDocs: [],
    topTopics: [],
    totalMatchedDocs: 0,
    totalQueries: 0,
    ...overrides,
  }
}

function makeHappyPathSummary(overrides: Partial<QueryLogSummary> = {}): QueryLogSummary {
  return makeZeroSummary({
    byStatus: {cancelled: 2, completed: 42, error: 3},
    byTier: {tier0: 12, tier1: 6, tier2: 15, tier3: 10, tier4: 4, unknown: 0},
    cacheHitRate: 18 / 42, // 18/completed
    coverageRate: 37 / 42, // (completed - queriesWithoutMatches) / completed
    knowledgeGaps: [
      {count: 4, exampleQueries: ['how to deploy?', 'deployment steps'], topic: 'deployment pipeline'},
      {count: 3, exampleQueries: ['rate limit'], topic: 'rate limiting'},
    ],
    queriesWithoutMatches: 5,
    responseTime: {avgMs: 1200, p50Ms: 320, p95Ms: 8500},
    topRecalledDocs: [
      {count: 8, path: 'authentication/oauth_flow.md'},
      {count: 6, path: 'tool_system/registry.md'},
      {count: 5, path: 'tui_architecture/components.md'},
    ],
    topTopics: [
      {count: 12, topic: 'authentication'},
      {count: 8, topic: 'cli_architecture'},
    ],
    totalMatchedDocs: 84,
    totalQueries: 47,
    ...overrides,
  })
}

function makeZeroMatchedSummary(): QueryLogSummary {
  return makeHappyPathSummary({
    coverageRate: 0,
    knowledgeGaps: [{count: 10, exampleQueries: ['foo'], topic: 'unknown topic'}],
    queriesWithoutMatches: 42,
    topRecalledDocs: [],
    totalMatchedDocs: 0,
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('formatQueryLogSummaryNarrative', () => {
  describe('empty state', () => {
    it('should return the empty-state message when totalQueries is 0', () => {
      const summary = makeZeroSummary()
      const out = formatQueryLogSummaryNarrative(summary)

      expect(out).to.equal(
        'No queries recorded in the selected period. Your knowledge base is ready — try asking a question!',
      )
    })
  })

  describe('happy path', () => {
    let narrative: string

    before(() => {
      narrative = formatQueryLogSummaryNarrative(makeHappyPathSummary())
    })

    it('should include total queries asked', () => {
      expect(narrative).to.include('47 questions')
    })

    it('should report answered count as completed minus queriesWithoutMatches', () => {
      expect(narrative).to.include('answered 37 from curated knowledge')
    })

    it('should include coverage rate as percentage', () => {
      expect(narrative).to.include('88%')
    })

    it('should include cache hit rate as percentage', () => {
      expect(narrative).to.include('43%')
    })

    it('should include average response time in seconds for multi-second times', () => {
      expect(narrative).to.include('1.2s')
    })

    it('should include top recalled docs with counts', () => {
      expect(narrative).to.include('authentication/oauth_flow.md')
      expect(narrative).to.include('(8 queries)')
      expect(narrative).to.include('tool_system/registry.md')
      expect(narrative).to.include('(6 queries)')
    })

    it('should include knowledge gap topics', () => {
      expect(narrative).to.include('deployment pipeline')
      expect(narrative).to.include('rate limiting')
    })

    it('should include count of unanswered questions', () => {
      expect(narrative).to.match(/5 question/i)
    })

    it('should be a paragraph format, not a table or ASCII box', () => {
      expect(narrative).to.not.include('│')
      expect(narrative).to.not.include('┌')
      expect(narrative).to.not.include('═')
      expect(narrative).to.not.include('──────') // no horizontal separator
      expect(narrative).to.not.include('|    |') // no markdown table divider
    })

    it('should have multiple paragraphs separated by blank lines', () => {
      const paragraphs = narrative.split('\n\n').filter((p) => p.trim().length > 0)
      expect(paragraphs.length).to.be.at.least(2)
    })
  })

  describe('response time formatting', () => {
    it('should format sub-second times as ms', () => {
      const summary = makeHappyPathSummary({
        responseTime: {avgMs: 450, p50Ms: 300, p95Ms: 800},
      })
      const narrative = formatQueryLogSummaryNarrative(summary)
      expect(narrative).to.include('450ms')
    })

    it('should format multi-second times with one decimal place', () => {
      const summary = makeHappyPathSummary({
        responseTime: {avgMs: 2750, p50Ms: 1000, p95Ms: 5000},
      })
      const narrative = formatQueryLogSummaryNarrative(summary)
      expect(narrative).to.include('2.8s')
    })
  })

  describe('zero knowledge gaps', () => {
    it('should emit the "every question answered" line', () => {
      const summary = makeHappyPathSummary({knowledgeGaps: []})
      const narrative = formatQueryLogSummaryNarrative(summary)
      expect(narrative).to.include('Every question was answered from curated knowledge.')
    })

    it('should not include a gap suggestion', () => {
      const summary = makeHappyPathSummary({knowledgeGaps: []})
      const narrative = formatQueryLogSummaryNarrative(summary)
      expect(narrative).to.not.include('consider curating')
    })
  })

  describe('zero matched docs across all queries', () => {
    it('should omit the "Most useful knowledge" section', () => {
      const narrative = formatQueryLogSummaryNarrative(makeZeroMatchedSummary())
      expect(narrative).to.not.include('Most useful knowledge')
    })

    it('should still include the knowledge gaps section', () => {
      const narrative = formatQueryLogSummaryNarrative(makeZeroMatchedSummary())
      expect(narrative).to.include('unknown topic')
    })

    it('should report 0 answered and 0% coverage consistently', () => {
      const narrative = formatQueryLogSummaryNarrative(makeZeroMatchedSummary())
      expect(narrative).to.include('answered 0 from curated knowledge')
      expect(narrative).to.include('(0% coverage)')
    })
  })

  describe('top recalled docs limit', () => {
    it('should include at most the top 2 docs in narrative (prose brevity)', () => {
      const summary = makeHappyPathSummary({
        topRecalledDocs: [
          {count: 8, path: 'a.md'},
          {count: 6, path: 'b.md'},
          {count: 5, path: 'c.md'},
          {count: 4, path: 'd.md'},
        ],
      })
      const narrative = formatQueryLogSummaryNarrative(summary)
      expect(narrative).to.include('a.md')
      expect(narrative).to.include('b.md')
      expect(narrative).to.not.include('c.md')
      expect(narrative).to.not.include('d.md')
    })
  })

  describe('knowledge gaps limit', () => {
    it('should include at most the top 2 gap topics in narrative', () => {
      const summary = makeHappyPathSummary({
        knowledgeGaps: [
          {count: 4, exampleQueries: [], topic: 'alpha'},
          {count: 3, exampleQueries: [], topic: 'beta'},
          {count: 2, exampleQueries: [], topic: 'gamma'},
        ],
      })
      const narrative = formatQueryLogSummaryNarrative(summary)
      expect(narrative).to.include('alpha')
      expect(narrative).to.include('beta')
      expect(narrative).to.not.include('gamma')
    })
  })
})
