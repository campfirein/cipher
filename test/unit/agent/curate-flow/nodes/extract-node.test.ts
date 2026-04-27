import {expect} from 'chai'
import {stub} from 'sinon'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createExtractNode} from '../../../../../src/agent/infra/curation/flow/nodes/extract-node.js'

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
})
