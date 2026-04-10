import {expect} from 'chai'

import {EdgeDistribution} from '../../../../../src/agent/infra/swarm/engine/edge-distribution.js'
import {SwarmGraph} from '../../../../../src/agent/infra/swarm/engine/swarm-graph.js'
import {SwarmNode} from '../../../../../src/agent/infra/swarm/engine/swarm-node.js'

function buildChainGraph(): SwarmGraph {
  const graph = new SwarmGraph()
  const a = new SwarmNode({id: 'a', slug: 'a'})
  const b = new SwarmNode({id: 'b', slug: 'b'})
  const c = new SwarmNode({id: 'c', slug: 'c'})

  a.addSuccessor(b)
  b.addSuccessor(c)
  graph.addNode(a)
  graph.addNode(b)
  graph.addNode(c)

  return graph
}

describe('EdgeDistribution', () => {
  describe('constructor', () => {
    it('should initialize logits to 0 for initialProbability=0.5', () => {
      const dist = new EdgeDistribution({
        potentialConnections: [['a', 'b']],
      })

      expect(dist.edgeLogits.length).to.equal(1)
      expect(dist.edgeLogits[0]).to.be.closeTo(0, 1e-6)
    })

    it('should initialize logits correctly for initialProbability=0.9', () => {
      const dist = new EdgeDistribution({
        initialProbability: 0.9,
        potentialConnections: [['a', 'b']],
      })

      const expected = Math.log(0.9 / 0.1) // ~2.197
      expect(dist.edgeLogits[0]).to.be.closeTo(expected, 1e-4)
    })

    it('should have edgeLogits.length equal to potentialConnections.length', () => {
      const dist = new EdgeDistribution({
        potentialConnections: [
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'a'],
        ],
      })

      expect(dist.edgeLogits.length).to.equal(3)
    })
  })

  describe('realize', () => {
    it('should include all edges when random returns 0.01 (below sigmoid)', () => {
      const graph = buildChainGraph() // a->b->c
      const dist = new EdgeDistribution({
        potentialConnections: [['a', 'c']], // a->c is a shortcut, no cycle
      })

      // sigmoid(0) = 0.5, random=0.01 < 0.5 → include
      const result = dist.realize({graph, random: () => 0.01})

      const nodeA = result.graph.nodes.get('a')!
      expect(nodeA.successors.some((n) => n.id === 'c')).to.be.true
    })

    it('should exclude all edges when random returns 0.99 (above sigmoid)', () => {
      const graph = buildChainGraph() // a->b->c
      const dist = new EdgeDistribution({
        potentialConnections: [['a', 'c']],
      })

      // sigmoid(0) = 0.5, random=0.99 > 0.5 → exclude
      const result = dist.realize({graph, random: () => 0.99})

      const nodeA = result.graph.nodes.get('a')!
      // a should only have its original successor b, not c
      expect(nodeA.successors.some((n) => n.id === 'c')).to.be.false
    })

    it('should skip edges that would create a cycle', () => {
      const graph = buildChainGraph() // a->b->c
      const dist = new EdgeDistribution({
        initialProbability: 0.99, // very high → sigmoid ≈ 1
        potentialConnections: [['c', 'a']], // would create cycle c->a
      })

      // random=0.01 would include, but c->a creates cycle a->b->c->a
      const result = dist.realize({graph, random: () => 0.01})

      const nodeC = result.graph.nodes.get('c')!
      expect(nodeC.successors.some((n) => n.id === 'a')).to.be.false
    })

    it('should return log probability of the sampled configuration', () => {
      const graph = new SwarmGraph()
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})
      graph.addNode(a)
      graph.addNode(b)

      const dist = new EdgeDistribution({
        potentialConnections: [['a', 'b']],
      })

      // sigmoid(0) = 0.5, include → log(0.5)
      const result = dist.realize({graph, random: () => 0.01})

      expect(result.logProb).to.be.closeTo(Math.log(0.5), 1e-6)
    })

    it('should return unchanged graph and logProb=0 for empty connections', () => {
      const graph = buildChainGraph()
      const dist = new EdgeDistribution({potentialConnections: []})

      const result = dist.realize({graph})

      expect(result.graph.edgeCount).to.equal(graph.edgeCount)
      expect(result.logProb).to.equal(0)
    })
  })
})
