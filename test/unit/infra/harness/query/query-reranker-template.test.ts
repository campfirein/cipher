
import {expect} from 'chai'

import {rerankResults} from '../../../../../src/server/infra/harness/query/query-reranker-template.js'

function makeResult(overrides: Partial<{score: number; symbolPath: string; title: string}> = {}) {
  return {
    excerpt: 'some excerpt',
    path: '/some/path',
    score: overrides.score ?? 0.5,
    symbolPath: overrides.symbolPath ?? 'domain/topic/subtopic',
    title: overrides.title ?? 'Some Title',
  }
}

describe('rerankResults', () => {
  it('boosts results from same domain as top result (domain coherence)', () => {
    const template = `
reranking:
  domainCoherenceWeight: 0.1
  queryClassification: {}
`
    const results = [
      makeResult({score: 0.8, symbolPath: 'auth/login/handler'}),
      makeResult({score: 0.5, symbolPath: 'auth/login/middleware'}),
      makeResult({score: 0.4, symbolPath: 'database/models/user'}),
    ]

    rerankResults(results, template, 'test query')

    // Second result shares domain with top → gets +0.1
    expect(results[0].score).to.be.closeTo(0.8, 0.001) // top unchanged
    expect(results[1].score).to.be.closeTo(0.6, 0.001) // auth match → +0.1
    expect(results[2].score).to.be.closeTo(0.4, 0.001) // database → no boost
  })

  it('classifies "how" queries as exploratory', () => {
    const template = `
reranking:
  domainCoherenceWeight: 0
  queryClassification:
    exploratory:
      type: exploratory
      boost: 0.15
      domains:
        - guides
`
    const results = [
      makeResult({score: 0.6, symbolPath: 'guides/setup/intro'}),
      makeResult({score: 0.5, symbolPath: 'api/auth/handler'}),
    ]

    rerankResults(results, template, 'how to setup auth')

    // "how" → exploratory, guides domain gets +0.15
    expect(results[0].score).to.be.closeTo(0.75, 0.001)
    expect(results[1].score).to.be.closeTo(0.5, 0.001)
  })

  it('classifies "what is" queries as factual', () => {
    const template = `
reranking:
  domainCoherenceWeight: 0
  queryClassification:
    factual:
      type: factual
      boost: 0.1
      domains:
        - reference
`
    const results = [
      makeResult({score: 0.6, symbolPath: 'reference/glossary/terms'}),
      makeResult({score: 0.5, symbolPath: 'guides/setup/intro'}),
    ]

    rerankResults(results, template, 'what is a REST API')

    expect(results[0].score).to.be.closeTo(0.7, 0.001)
    expect(results[1].score).to.be.closeTo(0.5, 0.001)
  })

  it('returns results unchanged with zero weights (default)', () => {
    const template = `
reranking:
  domainCoherenceWeight: 0
  queryClassification: {}
`
    const results = [
      makeResult({score: 0.8, title: 'First'}),
      makeResult({score: 0.5, title: 'Second'}),
    ]

    rerankResults(results, template, 'some query')

    expect(results[0].score).to.equal(0.8)
    expect(results[1].score).to.equal(0.5)
  })

  it('clamps reranked scores to [0, 0.9999]', () => {
    const template = `
reranking:
  domainCoherenceWeight: 0.5
  queryClassification: {}
`
    const results = [
      makeResult({score: 0.9, symbolPath: 'auth/login/handler'}),
      makeResult({score: 0.8, symbolPath: 'auth/login/middleware'}),
    ]

    rerankResults(results, template, 'query')

    // 0.8 + 0.5 = 1.3, clamped to 0.9999. After sort it becomes first.
    expect(results[0].score).to.equal(0.9999)
    // 0.9 (top result, no self-boost), clamped stays 0.9
    expect(results[1].score).to.equal(0.9)
  })

  it('handles empty results', () => {
    const template = `
reranking:
  domainCoherenceWeight: 1
  queryClassification: {}
`
    const returned = rerankResults([], template, 'test query')
    expect(returned).to.deep.equal([])
  })
})
