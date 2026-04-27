/**
 * Phase 1 Task 1.5 — TopologicalCurationRunner.
 *
 * Asserts Kahn's-algorithm topological execution + pMap concurrency
 * + per-node fail-open + cycle detection.
 */

import {expect} from 'chai'

import type {NodeSlot} from '../../../../src/agent/core/curation/flow/types.js'

import {
  type CurationDAG,
  type CurationNode,
  CycleDetectedError,
  type NodeContext,
  TopologicalCurationRunner,
} from '../../../../src/agent/core/curation/flow/runner.js'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function makeNode<In, Out>(
  id: string,
  slot: NodeSlot,
  execute: (input: In, ctx: NodeContext) => Promise<Out>,
): CurationNode<In, Out> {
  return {execute, id, slot}
}

function emptyCtx(initialInput?: unknown): NodeContext {
  return {initialInput, taskId: 'test-task'}
}

describe('TopologicalCurationRunner', () => {
  describe('linear topological execution', () => {
    it('runs A → B → C with each step incrementing a counter', async () => {
      const a = makeNode<{value: number}, {value: number}>('a', 'recon', async (input) => ({
        value: input.value + 1,
      }))
      const b = makeNode<{value: number}, {value: number}>('b', 'extract', async (input) => ({
        value: input.value + 1,
      }))
      const c = makeNode<{value: number}, {value: number}>('c', 'write', async (input) => ({
        value: input.value + 1,
      }))

      const graph: CurationDAG = {
        edges: [
          {from: 'a', to: 'b'},
          {from: 'b', to: 'c'},
        ],
        entryNodeIds: ['a'],
        exitNodeIds: ['c'],
        maxConcurrency: 1,
        nodes: {a, b, c} as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, emptyCtx({value: 0}))

      expect(result.outputs.get('a')).to.deep.equal({value: 1})
      expect(result.outputs.get('b')).to.deep.equal({value: 2})
      expect(result.outputs.get('c')).to.deep.equal({value: 3})
      expect(result.failures).to.be.empty
    })
  })

  describe('diamond topology', () => {
    it('A → B, A → C, B → D, C → D — D receives both B and C outputs', async () => {
      const a = makeNode<unknown, {tag: string}>('a', 'recon', async () => ({tag: 'a'}))
      const b = makeNode<{tag: string}, {tag: string}>('b', 'extract', async () => ({tag: 'b'}))
      const c = makeNode<{tag: string}, {tag: string}>('c', 'extract', async () => ({tag: 'c'}))
      const d = makeNode<Record<string, {tag: string}>, {combined: string[]}>(
        'd',
        'write',
        async (input) => ({
          combined: Object.values(input)
            .map((v) => v.tag)
            .sort(),
        }),
      )

      const graph: CurationDAG = {
        edges: [
          {from: 'a', to: 'b'},
          {from: 'a', to: 'c'},
          {from: 'b', to: 'd'},
          {from: 'c', to: 'd'},
        ],
        entryNodeIds: ['a'],
        exitNodeIds: ['d'],
        maxConcurrency: 4,
        nodes: {a, b, c, d} as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, emptyCtx())

      expect(result.outputs.get('d')).to.deep.equal({combined: ['b', 'c']})
      expect(result.failures).to.be.empty
    })
  })

  describe('cycle detection', () => {
    it('throws CycleDetectedError on a graph with a cycle', async () => {
      const a = makeNode<unknown, unknown>('a', 'recon', async () => ({}))
      const b = makeNode<unknown, unknown>('b', 'extract', async () => ({}))
      const c = makeNode<unknown, unknown>('c', 'write', async () => ({}))

      const graph: CurationDAG = {
        edges: [
          {from: 'a', to: 'b'},
          {from: 'b', to: 'c'},
          {from: 'c', to: 'a'}, // cycle!
        ],
        entryNodeIds: [],
        exitNodeIds: ['c'],
        maxConcurrency: 1,
        nodes: {a, b, c} as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      let thrown: Error | undefined
      try {
        await runner.run(graph, emptyCtx())
      } catch (error) {
        thrown = error as Error
      }

      expect(thrown).to.be.instanceOf(CycleDetectedError)
    })
  })

  describe('per-node fail-open', () => {
    it('records failure and continues other branches when one node throws', async () => {
      // A → B (throws), A → C (succeeds). D depends on C only.
      const a = makeNode<unknown, {x: number}>('a', 'recon', async () => ({x: 1}))
      const b = makeNode<unknown, unknown>('b', 'extract', async () => {
        throw new Error('b boom')
      })
      const c = makeNode<unknown, {y: number}>('c', 'extract', async () => ({y: 2}))
      const d = makeNode<{y: number}, {z: number}>('d', 'write', async (input) => ({
        z: input.y + 10,
      }))

      const graph: CurationDAG = {
        edges: [
          {from: 'a', to: 'b'},
          {from: 'a', to: 'c'},
          {from: 'c', to: 'd'},
        ],
        entryNodeIds: ['a'],
        exitNodeIds: ['d'],
        maxConcurrency: 4,
        nodes: {a, b, c, d} as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, emptyCtx())

      // C/D branch succeeded
      expect(result.outputs.get('c')).to.deep.equal({y: 2})
      expect(result.outputs.get('d')).to.deep.equal({z: 12})

      // B failure recorded
      const bFailure = result.failures.find((f) => f.nodeId === 'b')
      expect(bFailure).to.exist
      expect(bFailure?.error).to.include('b boom')
    })
  })

  describe('bounded concurrency', () => {
    it('runs 4 sibling no-LLM nodes in parallel under maxConcurrency=4', async () => {
      const sleepMs = 100
      const a = makeNode<unknown, {tag: string}>('a', 'recon', async () => ({tag: 'a'}))
      const siblings = ['s1', 's2', 's3', 's4'].map((id) =>
        makeNode<unknown, {tag: string}>(id, 'extract', async () => {
          await delay(sleepMs)
          return {tag: id}
        }),
      )

      const graph: CurationDAG = {
        edges: siblings.map((s) => ({from: 'a', to: s.id})),
        entryNodeIds: ['a'],
        exitNodeIds: siblings.map((s) => s.id),
        maxConcurrency: 4,
        nodes: {
          a,
          ...Object.fromEntries(siblings.map((s) => [s.id, s])),
        } as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      const start = Date.now()
      const result = await runner.run(graph, emptyCtx())
      const elapsed = Date.now() - start

      // 4 siblings each take 100ms; with concurrency=4 they overlap → total ~100ms.
      // Allow generous CI headroom.
      expect(elapsed, `4-way parallel wall-clock under 250ms (got ${elapsed})`).to.be.lessThan(250)
      for (const s of siblings) {
        expect(result.outputs.get(s.id)).to.deep.equal({tag: s.id})
      }
    })

    it('serializes 4 sibling nodes when maxConcurrency=1', async () => {
      const sleepMs = 50
      const a = makeNode<unknown, {tag: string}>('a', 'recon', async () => ({tag: 'a'}))
      const siblings = ['s1', 's2', 's3', 's4'].map((id) =>
        makeNode<unknown, {tag: string}>(id, 'extract', async () => {
          await delay(sleepMs)
          return {tag: id}
        }),
      )

      const graph: CurationDAG = {
        edges: siblings.map((s) => ({from: 'a', to: s.id})),
        entryNodeIds: ['a'],
        exitNodeIds: siblings.map((s) => s.id),
        maxConcurrency: 1,
        nodes: {
          a,
          ...Object.fromEntries(siblings.map((s) => [s.id, s])),
        } as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      const start = Date.now()
      await runner.run(graph, emptyCtx())
      const elapsed = Date.now() - start

      // 4 siblings at 50ms each, serialized → at least 4*50=200ms
      expect(elapsed, `serialized wall-clock at least 180ms (got ${elapsed})`).to.be.gte(180)
    })
  })

  describe('input plumbing', () => {
    it('passes ctx.initialInput to entry nodes (no predecessors)', async () => {
      let received: unknown
      const a = makeNode<unknown, {ok: boolean}>('a', 'recon', async (input) => {
        received = input
        return {ok: true}
      })

      const graph: CurationDAG = {
        edges: [],
        entryNodeIds: ['a'],
        exitNodeIds: ['a'],
        maxConcurrency: 1,
        nodes: {a} as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      await runner.run(graph, emptyCtx({seed: 'value'}))

      expect(received).to.deep.equal({seed: 'value'})
    })

    it('passes single-predecessor output directly (no wrapping)', async () => {
      const a = makeNode<unknown, {x: number}>('a', 'recon', async () => ({x: 7}))
      let received: unknown
      const b = makeNode<unknown, unknown>('b', 'extract', async (input) => {
        received = input
        return {}
      })

      const graph: CurationDAG = {
        edges: [{from: 'a', to: 'b'}],
        entryNodeIds: ['a'],
        exitNodeIds: ['b'],
        maxConcurrency: 1,
        nodes: {a, b} as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      await runner.run(graph, emptyCtx())

      expect(received).to.deep.equal({x: 7})
    })

    it('keys multi-predecessor inputs by predecessor node id', async () => {
      const a = makeNode<unknown, {x: number}>('a', 'recon', async () => ({x: 1}))
      const b = makeNode<unknown, {y: number}>('b', 'recon', async () => ({y: 2}))
      let received: Record<string, unknown> | undefined
      const c = makeNode<Record<string, unknown>, unknown>('c', 'extract', async (input) => {
        received = input
        return {}
      })

      const graph: CurationDAG = {
        edges: [
          {from: 'a', to: 'c'},
          {from: 'b', to: 'c'},
        ],
        entryNodeIds: ['a', 'b'],
        exitNodeIds: ['c'],
        maxConcurrency: 2,
        nodes: {a, b, c} as Record<string, CurationNode<unknown, unknown>>,
      }

      const runner = new TopologicalCurationRunner()
      await runner.run(graph, emptyCtx())

      expect(received).to.deep.equal({a: {x: 1}, b: {y: 2}})
    })
  })
})
