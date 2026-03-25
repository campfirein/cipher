 
import {expect} from 'chai'

import {buildQueryFeedback, type QueryOutcome} from '../../../../../src/server/infra/harness/query/query-feedback-collector.js'

function makeOutcome(overrides: Partial<QueryOutcome> = {}): QueryOutcome {
  return {
    directHit: false,
    ood: false,
    prefetched: false,
    supplemented: false,
    tier: 4,
    ...overrides,
  }
}

describe('buildQueryFeedback', () => {
  const allNodeIds = {boost: 'boost-1', decompose: 'decompose-1', rerank: 'rerank-1'}

  it('Tier 2 (direct hit) → success feedback for all nodes', () => {
    const outcome = makeOutcome({directHit: true, tier: 2})
    const feedback = buildQueryFeedback(allNodeIds, outcome)

    expect(feedback).to.have.lengthOf(3)
    for (const entry of feedback) {
      expect(entry.success).to.equal(true)
    }
  })

  it('Tier 3 (prefetched) → partial success (alpha 0.7)', () => {
    const outcome = makeOutcome({prefetched: true, tier: 3})
    const feedback = buildQueryFeedback(allNodeIds, outcome)

    expect(feedback).to.have.lengthOf(3)
    // All marked success=true (caller should use recordOutcomeF1 with alpha=0.7)
    for (const entry of feedback) {
      expect(entry.success).to.equal(true)
    }
  })

  it('Tier 4 (no prefetch) → failure for all nodes', () => {
    const outcome = makeOutcome({tier: 4})
    const feedback = buildQueryFeedback(allNodeIds, outcome)

    expect(feedback).to.have.lengthOf(3)
    for (const entry of feedback) {
      expect(entry.success).to.equal(false)
    }
  })

  it('supplemented → decompose node gets failure', () => {
    const outcome = makeOutcome({directHit: true, supplemented: true, tier: 2})
    const feedback = buildQueryFeedback(allNodeIds, outcome)

    const decomposeFeedback = feedback.find((f) => f.nodeId === 'decompose-1')
    const boostFeedback = feedback.find((f) => f.nodeId === 'boost-1')
    const rerankFeedback = feedback.find((f) => f.nodeId === 'rerank-1')

    expect(decomposeFeedback!.success).to.equal(false)
    expect(boostFeedback!.success).to.equal(true)
    expect(rerankFeedback!.success).to.equal(true)
  })

  it('OOD → returns empty array (no feedback)', () => {
    const outcome = makeOutcome({ood: true})
    const feedback = buildQueryFeedback(allNodeIds, outcome)
    expect(feedback).to.deep.equal([])
  })

  it('only produces feedback for provided nodeIds', () => {
    const outcome = makeOutcome({directHit: true, tier: 2})
    const feedback = buildQueryFeedback({decompose: 'decompose-1'}, outcome)

    expect(feedback).to.have.lengthOf(1)
    expect(feedback[0].nodeId).to.equal('decompose-1')
  })
})
