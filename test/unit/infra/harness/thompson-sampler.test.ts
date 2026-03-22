import {expect} from 'chai'

import type {HarnessNode} from '../../../../src/server/core/interfaces/harness/i-harness-tree-store.js'

import {
  applyHeuristicDecay,
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  determineMode,
  FAST_PATH_THRESHOLD,
  sampleBeta,
  thompsonSelect,
  updateBetaParams,
  updateBetaParamsF1,
} from '../../../../src/server/infra/harness/thompson-sampler.js'

function createNode(overrides: Partial<HarnessNode> = {}): HarnessNode {
  return {
    alpha: DEFAULT_ALPHA,
    beta: DEFAULT_BETA,
    childIds: [],
    createdAt: Date.now(),
    heuristic: 0.5,
    id: `node-${Math.random().toString(36).slice(2)}`,
    metadata: {},
    parentId: null,
    templateContent: 'test: true',
    visitCount: 0,
    ...overrides,
  }
}

describe('thompson-sampler', () => {
  describe('sampleBeta', () => {
    it('should return values in [0, 1]', () => {
      for (let i = 0; i < 100; i++) {
        const sample = sampleBeta(1, 1)
        expect(sample).to.be.at.least(0)
        expect(sample).to.be.at.most(1)
      }
    })

    it('should handle extreme alpha/beta ratios', () => {
      // High alpha = high success rate → samples should be high
      const samples = Array.from({length: 100}, () => sampleBeta(100, 1))
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length
      expect(mean).to.be.greaterThan(0.8)
    })

    it('should handle small alpha/beta values', () => {
      for (let i = 0; i < 50; i++) {
        const sample = sampleBeta(0.01, 0.01)
        expect(sample).to.be.at.least(0)
        expect(sample).to.be.at.most(1)
      }
    })

    it('should produce different values on repeated calls (not constant)', () => {
      const samples = new Set(Array.from({length: 20}, () => sampleBeta(2, 2).toFixed(4)))
      expect(samples.size).to.be.greaterThan(1)
    })
  })

  describe('thompsonSelect', () => {
    it('should return null for empty array', () => {
      expect(thompsonSelect([])).to.be.null
    })

    it('should return the only node for single-element array', () => {
      const node = createNode({id: 'only'})
      expect(thompsonSelect([node])!.id).to.equal('only')
    })

    it('should prefer high-alpha nodes over many trials', () => {
      const highPerf = createNode({alpha: 50, beta: 1, id: 'high'})
      const lowPerf = createNode({alpha: 1, beta: 50, id: 'low'})

      let highCount = 0
      for (let i = 0; i < 100; i++) {
        const selected = thompsonSelect([highPerf, lowPerf])
        if (selected?.id === 'high') highCount++
      }

      // High-alpha node should be selected most of the time
      expect(highCount).to.be.greaterThan(80)
    })

    it('should occasionally explore low-alpha nodes (exploration)', () => {
      const established = createNode({alpha: 10, beta: 2, id: 'established'})
      const newNode = createNode({alpha: 1, beta: 1, id: 'new'})

      let newCount = 0
      for (let i = 0; i < 200; i++) {
        const selected = thompsonSelect([established, newNode])
        if (selected?.id === 'new') newCount++
      }

      // New node should be selected at least sometimes
      expect(newCount).to.be.greaterThan(0)
    })
  })

  describe('determineMode', () => {
    it('should return fast for heuristic >= threshold', () => {
      const node = createNode({heuristic: FAST_PATH_THRESHOLD})
      expect(determineMode(node)).to.equal('fast')
    })

    it('should return shadow for heuristic < threshold', () => {
      const node = createNode({heuristic: FAST_PATH_THRESHOLD - 1e-2})
      expect(determineMode(node)).to.equal('shadow')
    })

    it('should return fast for heuristic = 1.0', () => {
      const node = createNode({heuristic: 1})
      expect(determineMode(node)).to.equal('fast')
    })

    it('should return shadow for heuristic = 0', () => {
      const node = createNode({heuristic: 0})
      expect(determineMode(node)).to.equal('shadow')
    })
  })

  describe('updateBetaParams', () => {
    it('should increment alpha on success', () => {
      const node = createNode({alpha: 5, beta: 3})
      const result = updateBetaParams(node, true)
      expect(result.alpha).to.equal(6)
      expect(result.beta).to.equal(3)
    })

    it('should increment beta on failure', () => {
      const node = createNode({alpha: 5, beta: 3})
      const result = updateBetaParams(node, false)
      expect(result.alpha).to.equal(5)
      expect(result.beta).to.equal(4)
    })

    it('should compute correct heuristic', () => {
      const node = createNode({alpha: 9, beta: 1})
      const result = updateBetaParams(node, true)
      expect(result.heuristic).to.be.closeTo(10 / 11, 0.001)
    })
  })

  describe('updateBetaParamsF1', () => {
    it('should add fractional alpha/beta for shadow scoring', () => {
      const node = createNode({alpha: 5, beta: 3})
      const result = updateBetaParamsF1(node, 0.7, 0.3)
      expect(result.alpha).to.be.closeTo(5.7, 0.001)
      expect(result.beta).to.be.closeTo(3.3, 0.001)
    })

    it('should handle zero F1 (complete miss)', () => {
      const node = createNode({alpha: 5, beta: 3})
      const result = updateBetaParamsF1(node, 0, 1)
      expect(result.alpha).to.equal(5)
      expect(result.beta).to.equal(4)
    })

    it('should handle perfect F1', () => {
      const node = createNode({alpha: 5, beta: 3})
      const result = updateBetaParamsF1(node, 1, 0)
      expect(result.alpha).to.equal(6)
      expect(result.beta).to.equal(3)
    })
  })

  describe('applyHeuristicDecay', () => {
    it('should decay heuristic over time', () => {
      const node = createNode({heuristic: 0.9})
      const decayed = applyHeuristicDecay(node, 50)
      expect(decayed).to.be.lessThan(0.9)
      expect(decayed).to.be.greaterThan(0)
    })

    it('should not decay at day 0', () => {
      const node = createNode({heuristic: 0.9})
      const decayed = applyHeuristicDecay(node, 0)
      expect(decayed).to.equal(0.9)
    })

    it('should approach zero over many days', () => {
      const node = createNode({heuristic: 0.9})
      const decayed = applyHeuristicDecay(node, 1000)
      expect(decayed).to.be.lessThan(0.01)
    })
  })
})
