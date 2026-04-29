import {expect} from 'chai'
import {stub} from 'sinon'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createExtractNode} from '../../../../../src/agent/infra/curation/flow/nodes/extract-node.js'
import {delay} from '../../../../helpers/delay.js'

// Build a chunk-output-shaped fixture.
function chunkOutput(chunks: string[]): {
  boundaries: Array<{end: number; start: number}>
  chunks: string[]
  totalChunks: number
} {
  return {
    boundaries: chunks.map((c, i) => ({end: i + c.length, start: i})),
    chunks,
    totalChunks: chunks.length,
  }
}

describe('extractNode', () => {
  it('loops over every chunk and aggregates results', async () => {
    const extractStub = stub()
      .onFirstCall()
      .resolves({
        facts: [{statement: 'A', subject: 'auth'}],
        failed: 0,
        succeeded: 1,
        total: 1,
      })
      .onSecondCall()
      .resolves({
        facts: [
          {statement: 'B', subject: 'auth'},
          {statement: 'C', subject: 'db'},
        ],
        failed: 0,
        succeeded: 1,
        total: 1,
      })

    const ctx: NodeContext = {
      services: {extract: extractStub},
      taskId: 'task-extract-1',
    }

    const node = createExtractNode()
    const result = await node.execute(chunkOutput(['chunk-1', 'chunk-2']), ctx)

    expect(extractStub.callCount).to.equal(2)
    expect(extractStub.firstCall.args).to.deep.equal(['chunk-1', 'task-extract-1'])
    expect(extractStub.secondCall.args).to.deep.equal(['chunk-2', 'task-extract-1'])
    expect(result.facts).to.have.length(3)
    expect(result.total).to.equal(2)
    expect(result.succeeded).to.equal(2)
    expect(result.failed).to.equal(0)
  })

  it('returns empty result when chunks array is empty', async () => {
    const extractStub = stub()
    const ctx: NodeContext = {
      services: {extract: extractStub},
      taskId: 't',
    }

    const node = createExtractNode()
    const result = await node.execute(chunkOutput([]), ctx)

    expect(extractStub.called).to.be.false
    expect(result.facts).to.deep.equal([])
    expect(result.total).to.equal(0)
  })

  it('throws a clear error when services.extract is not provided AND there are chunks', async () => {
    const ctx: NodeContext = {taskId: 't'}
    const node = createExtractNode()

    let thrown: Error | undefined
    try {
      await node.execute(chunkOutput(['chunk-1']), ctx)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).to.exist
    expect(thrown?.message).to.match(/extract/i)
  })

  it('output passes the extract slot output schema', async () => {
    const extractStub = stub().resolves({
      facts: [{statement: 'fact', subject: 'topic'}],
      failed: 0,
      succeeded: 1,
      total: 1,
    })

    const ctx: NodeContext = {services: {extract: extractStub}, taskId: 't'}
    const node = createExtractNode()
    const result = await node.execute(chunkOutput(['x']), ctx)

    const parsed = slotContracts.extract.outputSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`output rejected by schema: ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it('declares the extract slot type', () => {
    const node = createExtractNode()
    expect(node.slot).to.equal('extract')
  })

  // ---------------------------------------------------------------------------
  // Phase 2 Task 2.4 — parallel fan-out via pMap
  // ---------------------------------------------------------------------------

  describe('parallel chunk fan-out (Phase 2)', () => {
    it('runs 8 chunks under concurrency 4 in ~250ms (4× speedup vs sequential)', async () => {
      const chunkLatencyMs = 100
      const extractStub = stub().callsFake(async () => {
        await delay(chunkLatencyMs)
        return {facts: [{statement: 's', subject: 'topic'}], failed: 0, succeeded: 1, total: 1}
      })

      const ctx: NodeContext = {
        extractConcurrency: 4,
        services: {extract: extractStub},
        taskId: 't',
      }
      const node = createExtractNode()
      const eight = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']

      const start = Date.now()
      const result = await node.execute(chunkOutput(eight), ctx)
      const elapsed = Date.now() - start

      expect(extractStub.callCount).to.equal(8)
      expect(result.facts).to.have.length(8)
      // 8 chunks × 100ms / concurrency 4 = ~200ms ideal; allow CI headroom.
      expect(elapsed, `parallel fan-out should be < 350ms (got ${elapsed})`).to.be.lessThan(350)
    })

    it('serializes when extractConcurrency is 1 (regression — proves pMap honours config)', async () => {
      const chunkLatencyMs = 50
      const extractStub = stub().callsFake(async () => {
        await delay(chunkLatencyMs)
        return {facts: [], failed: 0, succeeded: 1, total: 1}
      })

      const ctx: NodeContext = {
        extractConcurrency: 1,
        services: {extract: extractStub},
        taskId: 't',
      }
      const node = createExtractNode()
      const four = ['c1', 'c2', 'c3', 'c4']

      const start = Date.now()
      await node.execute(chunkOutput(four), ctx)
      const elapsed = Date.now() - start

      // 4 × 50ms serialized = ≥ 200ms (allow some scheduler slop).
      expect(elapsed, `serialized wall-clock at least 180ms (got ${elapsed})`).to.be.gte(180)
    })

    it('defaults extractConcurrency to 4 when omitted from NodeContext', async () => {
      // Default is 4 — 4 chunks × 100ms / 4 ≈ 100ms; sequential would be ≥ 400ms.
      const chunkLatencyMs = 100
      const extractStub = stub().callsFake(async () => {
        await delay(chunkLatencyMs)
        return {facts: [], failed: 0, succeeded: 1, total: 1}
      })

      const ctx: NodeContext = {services: {extract: extractStub}, taskId: 't'}
      const node = createExtractNode()
      const four = ['c1', 'c2', 'c3', 'c4']

      const start = Date.now()
      await node.execute(chunkOutput(four), ctx)
      const elapsed = Date.now() - start

      expect(elapsed, `default-4 fan-out should be < 250ms (got ${elapsed})`).to.be.lessThan(250)
    })

    it('aggregates per-chunk facts and counts (parallel order does not change content)', async () => {
      // Each chunk returns a fact whose statement reflects its own input.
      const extractStub = stub().callsFake(async (chunk: string) => ({
        facts: [{statement: `fact-from-${chunk}`, subject: 'topic'}],
        failed: 0,
        succeeded: 1,
        total: 1,
      }))

      const ctx: NodeContext = {
        extractConcurrency: 4,
        services: {extract: extractStub},
        taskId: 't',
      }
      const node = createExtractNode()
      const result = await node.execute(chunkOutput(['c1', 'c2', 'c3']), ctx)

      const statements = result.facts.map((f) => f.statement).sort()
      expect(statements).to.deep.equal(['fact-from-c1', 'fact-from-c2', 'fact-from-c3'])
      expect(result.total).to.equal(3)
      expect(result.succeeded).to.equal(3)
      expect(result.failed).to.equal(0)
    })
  })
})
