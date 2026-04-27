import {expect} from 'chai'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createChunkNode} from '../../../../../src/agent/infra/curation/flow/nodes/chunk-node.js'

function ctxWithContext(context: string): NodeContext {
  return {initialInput: {context, history: {}, meta: {}}, taskId: 'test-task'}
}

// Recon-output shape — chunk now receives this as its edge input.
function reconLike(suggestedChunkCount: number): {
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
    meta: {charCount: 0, lineCount: 0, messageCount: 0},
    suggestedChunkCount,
    suggestedMode: suggestedChunkCount === 1 ? 'single-pass' : 'chunked',
    tailPreview: '',
  }
}

describe('chunkNode', () => {
  it('returns a single chunk when suggestedChunkCount = 1', async () => {
    const node = createChunkNode()
    const result = await node.execute(reconLike(1), ctxWithContext('hello world'))

    expect(result.chunks).to.deep.equal(['hello world'])
    expect(result.totalChunks).to.equal(1)
    expect(result.boundaries).to.have.length(1)
    expect(result.boundaries[0]).to.deep.equal({end: 11, start: 0})
  })

  it('returns multiple chunks when suggestedChunkCount > 1 on a long input', async () => {
    const longText = 'A'.repeat(10_000)
    const node = createChunkNode()
    const result = await node.execute(reconLike(4), ctxWithContext(longText))

    expect(result.totalChunks).to.be.gte(2)
    expect(result.chunks.length).to.equal(result.totalChunks)
    const totalChars = result.chunks.reduce((sum, c) => sum + c.length, 0)
    expect(totalChars).to.be.gte(longText.length)
  })

  it('returns empty result when ctx.initialInput.context is empty', async () => {
    const node = createChunkNode()
    const result = await node.execute(reconLike(0), ctxWithContext(''))

    expect(result.chunks).to.deep.equal([])
    expect(result.totalChunks).to.equal(0)
    expect(result.boundaries).to.deep.equal([])
  })

  it('returns empty result when ctx.initialInput is missing entirely', async () => {
    const node = createChunkNode()
    const result = await node.execute(reconLike(1), {taskId: 't'})

    expect(result.chunks).to.deep.equal([])
    expect(result.totalChunks).to.equal(0)
  })

  it('output passes the chunk slot output schema', async () => {
    const node = createChunkNode()
    const result = await node.execute(reconLike(1), ctxWithContext('short text'))

    const parsed = slotContracts.chunk.outputSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`output rejected by schema: ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it('declares the chunk slot type', () => {
    const node = createChunkNode()
    expect(node.slot).to.equal('chunk')
  })
})
