import {expect} from 'chai'

import type {SwarmQueryResult} from '../../../../../src/agent/core/interfaces/i-swarm-coordinator.js'

import {formatQueryResults, formatQueryResultsJson} from '../../../../../src/agent/infra/swarm/cli/query-renderer.js'

function makeSwarmResult(overrides?: Partial<SwarmQueryResult>): SwarmQueryResult {
  return {
    meta: {
      costCents: 0,
      providers: {
        byterover: {latencyMs: 42, resultCount: 2},
      },
      queryType: 'factual',
      totalLatencyMs: 50,
    },
    results: [
      {
        content: 'Authentication uses JWT tokens with refresh rotation.',
        id: 'brv-0',
        metadata: {matchType: 'keyword', source: 'auth/jwt-tokens/context.md'},
        provider: 'byterover',
        score: 0.85,
      },
      {
        content: 'Token refresh happens every 15 minutes.',
        id: 'brv-1',
        metadata: {matchType: 'keyword', source: 'auth/refresh/context.md'},
        provider: 'byterover',
        score: 0.72,
      },
    ],
    ...overrides,
  }
}

describe('QueryRenderer', () => {
  describe('formatQueryResults()', () => {
    it('formats results with source, score, and content', () => {
      const result = makeSwarmResult()
      const output = formatQueryResults(result, 'auth tokens')

      expect(output).to.include('auth tokens')
      expect(output).to.include('auth/jwt-tokens/context.md')
      expect(output).to.include('0.85')
      expect(output).to.include('Authentication uses JWT')
    })

    it('shows query type classification', () => {
      const result = makeSwarmResult({
        meta: {...makeSwarmResult().meta, queryType: 'temporal'},
      })
      const output = formatQueryResults(result, 'what changed yesterday')

      expect(output).to.include('temporal')
    })

    it('shows provider metadata', () => {
      const result = makeSwarmResult()
      const output = formatQueryResults(result, 'test')

      expect(output).to.include('byterover')
      expect(output).to.include('42ms')
    })

    it('shows total latency', () => {
      const result = makeSwarmResult()
      const output = formatQueryResults(result, 'test')

      expect(output).to.include('50ms')
    })

    it('handles empty results gracefully', () => {
      const result = makeSwarmResult({results: []})
      const output = formatQueryResults(result, 'nonexistent topic')

      expect(output).to.include('No results')
    })
  })

  describe('formatQueryResultsJson()', () => {
    it('returns valid JSON structure', () => {
      const result = makeSwarmResult()
      const json = formatQueryResultsJson(result)
      const parsed = JSON.parse(json)

      expect(parsed).to.have.property('meta')
      expect(parsed).to.have.property('results')
      expect(parsed.results).to.have.length(2)
    })
  })
})
