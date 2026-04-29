import {expect} from 'chai'

import {NODE_SLOT_ORDER} from '../../../../src/agent/core/curation/flow/types.js'
import {buildCurationDAG} from '../../../../src/agent/infra/curation/flow/dag-builder.js'

describe('buildCurationDAG', () => {
  describe('default linear topology', () => {
    it('produces a DAG with 7 nodes (one per slot)', () => {
      const dag = buildCurationDAG()
      expect(Object.keys(dag.nodes)).to.have.length(7)
    })

    it('wires nodes in canonical order: recon → chunk → extract → group → dedup → conflict → write', () => {
      const dag = buildCurationDAG()

      // Build adjacency map for assertion
      const successors: Record<string, string[]> = {}
      for (const slot of NODE_SLOT_ORDER) {
        successors[slot] = []
      }

      for (const {from, to} of dag.edges) {
        successors[from].push(to)
      }

      expect(successors.recon).to.deep.equal(['chunk'])
      expect(successors.chunk).to.deep.equal(['extract'])
      expect(successors.extract).to.deep.equal(['group'])
      expect(successors.group).to.deep.equal(['dedup'])
      expect(successors.dedup).to.deep.equal(['conflict'])
      expect(successors.conflict).to.deep.equal(['write'])
      expect(successors.write).to.deep.equal([])
    })

    it('declares recon as the only entry node', () => {
      const dag = buildCurationDAG()
      expect([...dag.entryNodeIds]).to.deep.equal(['recon'])
    })

    it('declares write as the only exit node', () => {
      const dag = buildCurationDAG()
      expect([...dag.exitNodeIds]).to.deep.equal(['write'])
    })
  })

  describe('node identity', () => {
    it('every node has its slot as its id by default', () => {
      const dag = buildCurationDAG()
      for (const slot of NODE_SLOT_ORDER) {
        expect(dag.nodes[slot]).to.exist
        expect(dag.nodes[slot].id).to.equal(slot)
        expect(dag.nodes[slot].slot).to.equal(slot)
      }
    })

    it('every node exposes an execute function', () => {
      const dag = buildCurationDAG()
      for (const slot of NODE_SLOT_ORDER) {
        expect(dag.nodes[slot].execute).to.be.a('function')
      }
    })
  })

  describe('configuration', () => {
    it('defaults maxConcurrency to 1 in Phase 1 (parallel fan-out is Phase 2)', () => {
      const dag = buildCurationDAG()
      expect(dag.maxConcurrency).to.equal(1)
    })

    it('accepts a maxConcurrency override', () => {
      const dag = buildCurationDAG({maxConcurrency: 4})
      expect(dag.maxConcurrency).to.equal(4)
    })
  })

  describe('edge integrity', () => {
    it('produces exactly 6 edges (linear chain of 7 nodes)', () => {
      const dag = buildCurationDAG()
      expect(dag.edges).to.have.length(6)
    })

    it('every edge endpoint references a node that exists', () => {
      const dag = buildCurationDAG()
      const nodeIds = new Set(Object.keys(dag.nodes))

      for (const {from, to} of dag.edges) {
        expect(nodeIds.has(from), `edge from ${from}`).to.be.true
        expect(nodeIds.has(to), `edge to ${to}`).to.be.true
      }
    })
  })
})
