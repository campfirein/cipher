import {expect} from 'chai'

import type {SwarmQueryResult} from '../../../../../src/agent/core/interfaces/i-swarm-coordinator.js'

import {
  formatQueryResults,
  formatQueryResultsExplain,
  formatQueryResultsJson,
  providerTypeToLabel,
} from '../../../../../src/agent/infra/swarm/cli/query-renderer.js'

/** Strip ANSI escape codes so assertions match visible text. */
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replaceAll(/\u001B\[[0-9;]*m/g, '')

function makeSwarmResult(overrides?: Partial<SwarmQueryResult>): SwarmQueryResult {
  return {
    meta: {
      costCents: 0,
      providers: {
        byterover: {latencyMs: 42, resultCount: 2, selected: true},
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
        providerType: 'byterover',
        score: 0.85,
      },
      {
        content: 'Token refresh happens every 15 minutes.',
        id: 'brv-1',
        metadata: {matchType: 'keyword', source: 'auth/refresh/context.md'},
        provider: 'byterover',
        providerType: 'byterover',
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

    it('shows provider count in header', () => {
      const result = makeSwarmResult()
      const output = formatQueryResults(result, 'test')

      expect(output).to.include('1 queried')
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

    it('shows source labels per result', () => {
      const result = makeSwarmResult({
        results: [
          {
            content: 'Auth content',
            id: 'brv-0',
            metadata: {matchType: 'keyword', source: 'auth.md'},
            provider: 'byterover',
            providerType: 'byterover',
            score: 0.8,
          },
          {
            content: 'Notes content',
            id: 'obs-0',
            metadata: {matchType: 'graph', source: 'notes.md'},
            provider: 'obsidian',
            providerType: 'obsidian',
            score: 0.6,
          },
          {
            content: 'Concept content',
            id: 'gb-0',
            metadata: {matchType: 'semantic', path: 'concept', source: 'concept'},
            provider: 'gbrain',
            providerType: 'gbrain',
            score: 0.4,
          },
          {
            content: 'Doc content',
            id: 'lm-0',
            metadata: {matchType: 'keyword', source: 'doc.md'},
            provider: 'local-markdown:project-docs',
            providerType: 'local-markdown',
            score: 0.3,
          },
        ],
      })
      const output = formatQueryResults(result, 'test')

      expect(output).to.include('[context-tree]')
      expect(output).to.include('[obsidian]')
      expect(output).to.include('[gbrain]')
      expect(output).to.include('[notes:project-docs]')
    })

    it('shows simplified provider count in header', () => {
      const result = makeSwarmResult({
        meta: {
          costCents: 0,
          providers: {
            byterover: {latencyMs: 10, resultCount: 1, selected: true},
            gbrain: {latencyMs: 200, resultCount: 0, selected: true},
            obsidian: {latencyMs: 80, resultCount: 2, selected: true},
          },
          queryType: 'factual',
          totalLatencyMs: 300,
        },
      })
      const output = stripAnsi(formatQueryResults(result, 'test'))

      expect(output).to.include('Providers: 3 queried')
    })
  })

  describe('providerTypeToLabel()', () => {
    it('maps byterover to context-tree', () => {
      expect(providerTypeToLabel('byterover', 'byterover')).to.equal('context-tree')
    })

    it('maps obsidian to obsidian', () => {
      expect(providerTypeToLabel('obsidian', 'obsidian')).to.equal('obsidian')
    })

    it('maps gbrain to gbrain', () => {
      expect(providerTypeToLabel('gbrain', 'gbrain')).to.equal('gbrain')
    })

    it('maps local-markdown with name', () => {
      expect(providerTypeToLabel('local-markdown', 'local-markdown:notes')).to.equal('notes:notes')
    })

    it('maps local-markdown without name', () => {
      expect(providerTypeToLabel('local-markdown', 'local-markdown')).to.equal('notes:files')
    })
  })

  describe('formatQueryResultsExplain()', () => {
    it('shows classification reasoning', () => {
      const result = makeSwarmResult()
      const output = stripAnsi(formatQueryResultsExplain(result, 'auth tokens'))

      expect(output).to.include('Classification: factual')
    })

    it('shows provider selection with excluded providers', () => {
      const result = makeSwarmResult({
        meta: {
          costCents: 0,
          providers: {
            byterover: {latencyMs: 10, resultCount: 1, selected: true},
            gbrain: {
              excludeReason: 'not in selection matrix for personal',
              latencyMs: 0,
              resultCount: 0,
              selected: false,
            },
          },
          queryType: 'personal',
          totalLatencyMs: 100,
        },
      })
      const output = formatQueryResultsExplain(result, 'I prefer typescript')

      expect(output).to.include('byterover')
      expect(output).to.include('selected')
      expect(output).to.include('gbrain')
      expect(output).to.include('excluded')
    })

    it('shows enrichment excerpts when present', () => {
      const result = makeSwarmResult({
        meta: {
          costCents: 0,
          providers: {
            byterover: {latencyMs: 10, resultCount: 1, selected: true},
            obsidian: {
              enrichedBy: 'byterover',
              enrichmentExcerpts: ['JWT', 'token', 'refresh'],
              latencyMs: 80,
              resultCount: 2,
              selected: true,
            },
          },
          queryType: 'factual',
          totalLatencyMs: 100,
        },
      })
      const output = formatQueryResultsExplain(result, 'JWT auth')

      expect(output).to.include('Enrichment')
      expect(output).to.include('JWT')
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

    it('includes providerType in results', () => {
      const result = makeSwarmResult()
      const json = formatQueryResultsJson(result)
      const parsed = JSON.parse(json)

      expect(parsed.results[0]).to.have.property('providerType', 'byterover')
    })

    it('includes selection metadata in providers', () => {
      const result = makeSwarmResult()
      const json = formatQueryResultsJson(result)
      const parsed = JSON.parse(json)

      expect(parsed.meta.providers.byterover).to.have.property('selected', true)
    })
  })
})
