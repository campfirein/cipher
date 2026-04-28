/**
 * Phase 1 Task 1.5 — TopologicalCurationRunner (extended in Phase 2 Task 2.3).
 *
 * Asserts Kahn's-algorithm topological execution + pMap concurrency
 * + per-node fail-open + cycle detection.
 *
 * Phase 2 additions: sandboxed-by-default execution with per-slot
 * timeout, parent-signal propagation, and schema-gate (soft mode)
 * enforcement. Existing Phase 1 tests use synthetic input shapes that
 * do NOT match the real slot schemas, so they explicitly opt out via
 * `sandboxed: false` to keep the runner-level concern separate from
 * what each test is asserting.
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
import {delay} from '../../../helpers/delay.js'

function makeNode<In, Out>(
  id: string,
  slot: NodeSlot,
  execute: (input: In, ctx: NodeContext) => Promise<Out>,
): CurationNode<In, Out> {
  return {execute, id, slot}
}

// Synthetic-shape tests bypass sandbox so the runner doesn't try to
// schema-validate `{value: number}` against `reconInputSchema`.
function emptyCtx(initialInput?: unknown): NodeContext {
  return {initialInput, sandboxed: false, taskId: 'test-task'}
}

// Helpers shared by Phase 2 sandboxed-execution tests. Module-scoped to
// satisfy `unicorn/consistent-function-scoping`.
function reconLikeInput(): {context: string; history: Record<string, unknown>; meta: Record<string, unknown>} {
  // Matches reconInputSchema: {context, history, meta}
  return {context: 'hello', history: {}, meta: {}}
}

function reconLikeOutput(): {
  headPreview: string
  history: {domains: Record<string, string[]>; totalProcessed: number}
  meta: {charCount: number; lineCount: number; messageCount: number}
  suggestedChunkCount: number
  suggestedMode: 'chunked' | 'single-pass'
  tailPreview: string
} {
  return {
    headPreview: '',
    history: {domains: {}, totalProcessed: 0},
    meta: {charCount: 5, lineCount: 1, messageCount: 0},
    suggestedChunkCount: 1,
    suggestedMode: 'single-pass',
    tailPreview: '',
  }
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

  // -------------------------------------------------------------------------
  // Phase 2 Task 2.3 — sandbox + schema-gate wired into the runner.
  // Default: ctx.sandboxed = true. Tests below construct DAGs whose nodes use
  // real slot shapes (recon's input/output schemas) so the gate runs cleanly.
  // -------------------------------------------------------------------------

  describe('sandboxed execution (Phase 2)', () => {
    it('defaults sandboxed to true when omitted from NodeContext', async () => {
      // Recon node returning valid recon output → passes schema gate cleanly.
      const recon = makeNode<unknown, unknown>('recon', 'recon', async () => reconLikeOutput())

      const graph: CurationDAG = {
        edges: [],
        entryNodeIds: ['recon'],
        exitNodeIds: ['recon'],
        maxConcurrency: 1,
        nodes: {recon},
      }

      const runner = new TopologicalCurationRunner()
      // No `sandboxed` key — default behavior should be ON and still pass.
      const result = await runner.run(graph, {
        initialInput: reconLikeInput(),
        taskId: 't',
      })

      expect(result.failures, 'no failures expected on schema-clean run').to.be.empty
      expect(result.outputs.get('recon')).to.deep.equal(reconLikeOutput())
    })

    it('strands downstream when INPUT schema fails (W4: avoids cascade of confusing warnings)', async () => {
      // recon expects {context, history, meta}. We pass garbage, which
      // fails inputSchema. Downstream chunk should be stranded with a
      // single clear failure — NOT cascaded through the whole DAG.
      let chunkRan = false
      const recon = makeNode<unknown, unknown>('recon', 'recon', async () => reconLikeOutput())
      const chunk = makeNode<unknown, unknown>('chunk', 'chunk', async () => {
        chunkRan = true
        return {boundaries: [], chunks: [], totalChunks: 0}
      })

      const graph: CurationDAG = {
        edges: [{from: 'recon', to: 'chunk'}],
        entryNodeIds: ['recon'],
        exitNodeIds: ['chunk'],
        maxConcurrency: 1,
        nodes: {chunk, recon},
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, {
        // Garbage shape — recon's inputSchema requires {context, history, meta}.
        initialInput: {garbage: true},
        sandboxed: true,
        taskId: 't',
      })

      const reconFailure = result.failures.find((f) => f.nodeId === 'recon')
      expect(reconFailure?.error).to.match(/recon|input|schema/i)
      expect(chunkRan, 'downstream must NOT run after upstream input-fail').to.be.false
    })

    it('records (does NOT throw) a schema warning when output is malformed (soft-fail)', async () => {
      // Recon node returning a broken shape → soft-fail records into failures.
      const recon = makeNode<unknown, unknown>('recon', 'recon', async () => ({
        // Missing required fields like history.domains, meta.charCount, etc.
        suggestedMode: 'single-pass',
      }))

      const graph: CurationDAG = {
        edges: [],
        entryNodeIds: ['recon'],
        exitNodeIds: ['recon'],
        maxConcurrency: 1,
        nodes: {recon},
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, {
        initialInput: reconLikeInput(),
        sandboxed: true,
        taskId: 't',
      })

      const reconFailure = result.failures.find((f) => f.nodeId === 'recon')
      expect(reconFailure, 'schema warning should be recorded').to.exist
      expect(reconFailure?.error).to.match(/schema|recon|suggestedMode/i)
    })

    it('aborts a node that exceeds its slot timeout (NodeTimeoutError recorded)', async () => {
      // recon timeoutMs = 10_000; we override via ctx for fast test execution.
      const recon = makeNode<unknown, unknown>('recon', 'recon', async (_input, ctx) => {
        await delay(500, ctx.signal)
        return reconLikeOutput()
      })

      const graph: CurationDAG = {
        edges: [],
        entryNodeIds: ['recon'],
        exitNodeIds: ['recon'],
        maxConcurrency: 1,
        nodes: {recon},
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, {
        initialInput: reconLikeInput(),
        sandboxed: true,
        slotTimeoutOverrideMs: 30,
        taskId: 't',
      })

      const reconFailure = result.failures.find((f) => f.nodeId === 'recon')
      expect(reconFailure).to.exist
      expect(reconFailure?.error).to.match(/timeout|aborted|recon/i)
    })

    it('strands downstream nodes when an upstream node times out', async () => {
      const recon = makeNode<unknown, unknown>('recon', 'recon', async (_input, ctx) => {
        await delay(500, ctx.signal)
        return reconLikeOutput()
      })
      let downstreamRan = false
      const chunk = makeNode<unknown, unknown>('chunk', 'chunk', async () => {
        downstreamRan = true
        return {boundaries: [], chunks: [], totalChunks: 0}
      })

      const graph: CurationDAG = {
        edges: [{from: 'recon', to: 'chunk'}],
        entryNodeIds: ['recon'],
        exitNodeIds: ['chunk'],
        maxConcurrency: 1,
        nodes: {chunk, recon},
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, {
        initialInput: reconLikeInput(),
        sandboxed: true,
        slotTimeoutOverrideMs: 30,
        taskId: 't',
      })

      expect(downstreamRan, 'downstream must NOT run after upstream timeout').to.be.false
      expect(result.failures.find((f) => f.nodeId === 'chunk')?.error).to.match(/skipped|predecessor/i)
    })

    it('opts out cleanly with sandboxed=false (escape hatch for tests)', async () => {
      // The synthetic shape would fail recon schema, but sandboxed=false
      // bypasses the gate entirely — proves the escape hatch works.
      const recon = makeNode<unknown, unknown>('recon', 'recon', async () => ({arbitrary: 'shape'}))

      const graph: CurationDAG = {
        edges: [],
        entryNodeIds: ['recon'],
        exitNodeIds: ['recon'],
        maxConcurrency: 1,
        nodes: {recon},
      }

      const runner = new TopologicalCurationRunner()
      const result = await runner.run(graph, {
        initialInput: {anything: 'goes'},
        sandboxed: false,
        taskId: 't',
      })

      expect(result.failures).to.be.empty
      expect(result.outputs.get('recon')).to.deep.equal({arbitrary: 'shape'})
    })

    it('exposes the allowlist-proxied tools (NOT raw ctx.tools) inside the node — E1 regression', async () => {
      // The runner must thread the proxied tools from the sandbox into
      // slotCtx, otherwise nodes can call ctx.tools.* directly and bypass
      // the per-slot allowlist. This was a latent bug pre-fix because no
      // default node touches ctx.tools, but Phase 3 agent code will.
      let toolError: Error | undefined
      const recon = makeNode<unknown, unknown>('recon', 'recon', async (_input, ctx) => {
        try {
          // recon's allowlist is ['tools.curation.recon'] — calling
          // tools.curate (in write's allowlist, NOT recon's) must throw.
          ;(ctx.tools as {curate: () => string}).curate()
        } catch (error) {
          toolError = error as Error
        }

        return reconLikeOutput()
      })

      const graph: CurationDAG = {
        edges: [],
        entryNodeIds: ['recon'],
        exitNodeIds: ['recon'],
        maxConcurrency: 1,
        nodes: {recon},
      }

      await new TopologicalCurationRunner().run(graph, {
        initialInput: reconLikeInput(),
        sandboxed: true,
        taskId: 't',
        // Raw tools that include `curate` — proxy must filter it out for recon slot.
        tools: {curate: () => 'should-not-reach', curation: {recon: () => 'ok'}},
      })

      expect(toolError, 'node should see allowlist-proxied tools, not raw ctx.tools').to.exist
      expect(toolError?.name).to.equal('ToolAccessViolation')
    })
  })
})
