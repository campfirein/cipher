import {expect} from 'chai'

import type {QueryResult} from '../../../../src/agent/core/domain/swarm/types.js'

import {mergeResults} from '../../../../src/agent/infra/swarm/swarm-merger.js'

function makeResult(provider: string, content: string, score: number): QueryResult {
  return {
    content,
    id: `${provider}-${content.slice(0, 10)}`,
    metadata: {matchType: 'keyword', source: `${content}.md`},
    provider,
    score,
  }
}

describe('SwarmMerger', () => {
  it('fuses results from multiple providers using RRF', () => {
    const resultSets = new Map<string, QueryResult[]>([
      ['byterover', [makeResult('byterover', 'Auth tokens', 0.9), makeResult('byterover', 'JWT refresh', 0.7)]],
      ['obsidian', [makeResult('obsidian', 'Token rotation', 0.8), makeResult('obsidian', 'Auth tokens', 0.6)]],
    ])
    const weights = new Map([['byterover', 0.9], ['obsidian', 0.8]])

    const merged = mergeResults(resultSets, weights)
    expect(merged.length).to.be.greaterThan(0)
    // Results should be sorted by RRF score descending
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].score).to.be.at.most(merged[i - 1].score)
    }
  })

  it('deduplicates by content (keeps higher-scored version)', () => {
    const resultSets = new Map<string, QueryResult[]>([
      ['byterover', [makeResult('byterover', 'Auth tokens', 0.9)]],
      ['obsidian', [makeResult('obsidian', 'Auth tokens', 0.7)]],
    ])
    const weights = new Map([['byterover', 0.9], ['obsidian', 0.8]])

    const merged = mergeResults(resultSets, weights)
    const authResults = merged.filter((r) => r.content === 'Auth tokens')
    // Should be deduplicated to one entry
    expect(authResults).to.have.length(1)
  })

  it('keeps duplicate provenance from the strongest contributing occurrence', () => {
    const rankedDuplicate = makeResult('ranked-first', 'Shared content', 0.4)
    rankedDuplicate.metadata.source = 'ranked-first.md'

    const lowRankDuplicate = makeResult('higher-weight', 'Shared content', 0.9)
    lowRankDuplicate.metadata.source = 'higher-weight.md'

    const resultSets = new Map<string, QueryResult[]>([
      ['higher-weight', [
        ...Array.from({length: 20}, (_, index) => makeResult('higher-weight', `Filler ${index}`, 0.9 - index * 0.01)),
        lowRankDuplicate,
      ]],
      ['ranked-first', [rankedDuplicate]],
    ])
    const weights = new Map([['higher-weight', 1], ['ranked-first', 0.9]])

    const merged = mergeResults(resultSets, weights)
    const shared = merged.find((result) => result.content === 'Shared content')

    expect(shared).to.exist
    expect(shared!.provider).to.equal('ranked-first')
    expect(shared!.metadata.source).to.equal('ranked-first.md')
  })

  it('respects maxResults', () => {
    const results: QueryResult[] = []
    for (let i = 0; i < 20; i++) {
      results.push(makeResult('byterover', `Result ${i}`, 0.9 - i * 0.01))
    }

    const resultSets = new Map([['byterover', results]])
    const weights = new Map([['byterover', 1]])

    const merged = mergeResults(resultSets, weights, {maxResults: 5})
    expect(merged).to.have.length(5)
  })

  it('returns empty for empty input', () => {
    const merged = mergeResults(new Map(), new Map())
    expect(merged).to.have.length(0)
  })

  it('handles single provider correctly', () => {
    const resultSets = new Map([
      ['byterover', [makeResult('byterover', 'Auth', 0.9), makeResult('byterover', 'JWT', 0.7)]],
    ])
    const weights = new Map([['byterover', 1]])

    const merged = mergeResults(resultSets, weights)
    expect(merged).to.have.length(2)
  })

  it('weights affect ranking', () => {
    // Provider with higher weight should boost its results
    const resultSets = new Map<string, QueryResult[]>([
      ['high-weight', [makeResult('high-weight', 'Result A', 0.5)]],
      ['low-weight', [makeResult('low-weight', 'Result B', 0.5)]],
    ])
    const weights = new Map([['high-weight', 1], ['low-weight', 0.1]])

    const merged = mergeResults(resultSets, weights)
    expect(merged[0].content).to.equal('Result A')
  })

  it('uses K=60 by default', () => {
    const resultSets = new Map([
      ['p1', [makeResult('p1', 'Only result', 0.9)]],
    ])
    const weights = new Map([['p1', 1]])

    const merged = mergeResults(resultSets, weights)
    // RRF score for rank 0 with K=60, weight 1.0: 1.0 / (60 + 0) = ~0.0167
    expect(merged[0].score).to.be.closeTo(1 / 60, 0.001)
  })
})
