import {expect} from 'chai'

import {SwarmNode} from '../../../../../src/agent/infra/swarm/engine/swarm-node.js'

describe('SwarmNode', () => {
  it('should initialize with id, slug, and empty arrays', () => {
    const node = new SwarmNode({id: 'n1', slug: 'analyzer'})

    expect(node.id).to.equal('n1')
    expect(node.slug).to.equal('analyzer')
    expect(node.predecessors).to.deep.equal([])
    expect(node.successors).to.deep.equal([])
  })

  describe('addPredecessor', () => {
    it('should add bidirectional link', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      b.addPredecessor(a)

      expect(b.predecessors).to.include(a)
      expect(a.successors).to.include(b)
    })

    it('should be idempotent', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      b.addPredecessor(a)
      b.addPredecessor(a)

      expect(b.predecessors).to.have.lengthOf(1)
      expect(a.successors).to.have.lengthOf(1)
    })
  })

  describe('addSuccessor', () => {
    it('should add bidirectional link', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      a.addSuccessor(b)

      expect(a.successors).to.include(b)
      expect(b.predecessors).to.include(a)
    })

    it('should be idempotent', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      a.addSuccessor(b)
      a.addSuccessor(b)

      expect(a.successors).to.have.lengthOf(1)
      expect(b.predecessors).to.have.lengthOf(1)
    })
  })

  describe('removePredecessor', () => {
    it('should remove bidirectional link', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      b.addPredecessor(a)
      b.removePredecessor(a)

      expect(b.predecessors).to.deep.equal([])
      expect(a.successors).to.deep.equal([])
    })

    it('should be safe to call when not linked', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      b.removePredecessor(a)

      expect(b.predecessors).to.deep.equal([])
    })
  })

  describe('removeSuccessor', () => {
    it('should remove bidirectional link', () => {
      const a = new SwarmNode({id: 'a', slug: 'a'})
      const b = new SwarmNode({id: 'b', slug: 'b'})

      a.addSuccessor(b)
      a.removeSuccessor(b)

      expect(a.successors).to.deep.equal([])
      expect(b.predecessors).to.deep.equal([])
    })
  })
})
