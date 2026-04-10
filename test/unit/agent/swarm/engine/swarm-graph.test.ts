import {expect} from 'chai'

import {CycleDetectedError, SwarmGraph} from '../../../../../src/agent/infra/swarm/engine/swarm-graph.js'
import {SwarmNode} from '../../../../../src/agent/infra/swarm/engine/swarm-node.js'

describe('SwarmGraph', () => {
  it('should start empty', () => {
    const graph = new SwarmGraph()

    expect(graph.nodeCount).to.equal(0)
    expect(graph.edgeCount).to.equal(0)
    expect(graph.nodes.size).to.equal(0)
  })

  describe('addNode', () => {
    it('should register a node by id', () => {
      const graph = new SwarmGraph()
      const node = new SwarmNode({id: 'a', slug: 'analyzer'})

      graph.addNode(node)

      expect(graph.nodes.get('a')).to.equal(node)
      expect(graph.nodeCount).to.equal(1)
    })

    it('should throw on duplicate id', () => {
      const graph = new SwarmGraph()
      graph.addNode(new SwarmNode({id: 'a', slug: 'a'}))

      expect(() => graph.addNode(new SwarmNode({id: 'a', slug: 'b'}))).to.throw('Duplicate node id')
    })
  })

  describe('computeInDegrees', () => {
    it('should return correct in-degrees for chain A->B->C', () => {
      const graph = new SwarmGraph()
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})
      const c = new SwarmNode({id: 'c', slug: 'c'})

      a.addSuccessor(b)
      b.addSuccessor(c)
      graph.addNode(a)
      graph.addNode(b)
      graph.addNode(c)

      const degrees = graph.computeInDegrees()

      expect(degrees.get('a')).to.equal(0)
      expect(degrees.get('b')).to.equal(1)
      expect(degrees.get('c')).to.equal(1)
    })
  })

  describe('edgeCount', () => {
    it('should count edges correctly', () => {
      const graph = new SwarmGraph()
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})
      const c = new SwarmNode({id: 'c', slug: 'c'})

      a.addSuccessor(b)
      a.addSuccessor(c)
      b.addSuccessor(c)
      graph.addNode(a)
      graph.addNode(b)
      graph.addNode(c)

      expect(graph.edgeCount).to.equal(3)
    })
  })

  describe('topologicalSort', () => {
    it('should return valid order for chain A->B->C', () => {
      const graph = new SwarmGraph()
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})
      const c = new SwarmNode({id: 'c', slug: 'c'})

      a.addSuccessor(b)
      b.addSuccessor(c)
      graph.addNode(a)
      graph.addNode(b)
      graph.addNode(c)

      const order = graph.topologicalSort()

      expect(order.indexOf('a')).to.be.lessThan(order.indexOf('b'))
      expect(order.indexOf('b')).to.be.lessThan(order.indexOf('c'))
    })

    it('should work for diamond: A->B, A->C, B->D, C->D', () => {
      const graph = new SwarmGraph()
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})
      const c = new SwarmNode({id: 'c', slug: 'c'})
      const d = new SwarmNode({id: 'd', slug: 'd'})

      a.addSuccessor(b)
      a.addSuccessor(c)
      b.addSuccessor(d)
      c.addSuccessor(d)
      graph.addNode(a)
      graph.addNode(b)
      graph.addNode(c)
      graph.addNode(d)

      const order = graph.topologicalSort()

      expect(order.indexOf('a')).to.be.lessThan(order.indexOf('b'))
      expect(order.indexOf('a')).to.be.lessThan(order.indexOf('c'))
      expect(order.indexOf('b')).to.be.lessThan(order.indexOf('d'))
      expect(order.indexOf('c')).to.be.lessThan(order.indexOf('d'))
    })

    it('should throw CycleDetectedError on cycle A->B->C->A', () => {
      const graph = new SwarmGraph()
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})
      const c = new SwarmNode({id: 'c', slug: 'c'})

      a.addSuccessor(b)
      b.addSuccessor(c)
      c.addSuccessor(a)
      graph.addNode(a)
      graph.addNode(b)
      graph.addNode(c)

      expect(() => graph.topologicalSort()).to.throw(CycleDetectedError)
    })

    it('should work for single node', () => {
      const graph = new SwarmGraph()
      graph.addNode(new SwarmNode({id: 'a', slug: 'a'}))

      const order = graph.topologicalSort()

      expect(order).to.deep.equal(['a'])
    })
  })

  describe('checkCycle', () => {
    it('should detect reachability', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})
      const c = new SwarmNode({id: 'c', slug: 'c'})

      a.addSuccessor(b)
      b.addSuccessor(c)

      expect(SwarmGraph.checkCycle(a, c)).to.be.true
    })

    it('should return false when not reachable', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      a.addSuccessor(b)

      expect(SwarmGraph.checkCycle(b, a)).to.be.false
    })
  })

  describe('outputNodes', () => {
    it('should allow setting and getting output nodes', () => {
      const graph = new SwarmGraph()
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      graph.addNode(a)
      graph.addNode(b)
      graph.setOutputNodes(['b'])

      expect(graph.outputNodes).to.deep.equal([b])
    })
  })
})
