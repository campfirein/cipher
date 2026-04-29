import {expect} from 'chai'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createReconNode} from '../../../../../src/agent/infra/curation/flow/nodes/recon-node.js'

const ctx: NodeContext = {taskId: 'test-task'}

describe('reconNode', () => {
  it('returns suggestedMode "single-pass" for short input', async () => {
    const node = createReconNode()
    const result = await node.execute(
      {context: 'short input', history: {}, meta: {}},
      ctx,
    )

    expect(result.suggestedMode).to.equal('single-pass')
    expect(result.suggestedChunkCount).to.equal(1)
  })

  it('returns suggestedMode "chunked" for input above the threshold', async () => {
    const longContext = 'a'.repeat(50_000)
    const node = createReconNode()
    const result = await node.execute(
      {context: longContext, history: {}, meta: {}},
      ctx,
    )

    expect(result.suggestedMode).to.equal('chunked')
    expect(result.suggestedChunkCount).to.be.gte(2)
  })

  it('reports accurate meta counts', async () => {
    const node = createReconNode()
    const result = await node.execute(
      {context: 'line one\nline two\nline three', history: {}, meta: {}},
      ctx,
    )

    expect(result.meta.charCount).to.equal(28)
    expect(result.meta.lineCount).to.equal(3)
    expect(result.meta.messageCount).to.equal(0)
  })

  it('summarizes history domains from past entries', async () => {
    const node = createReconNode()
    const result = await node.execute(
      {
        context: 'short',
        history: {
          entries: [
            {domain: 'auth', title: 'JWT-tokens'},
            {domain: 'auth', title: 'OAuth-flow'},
            {domain: 'database', title: 'Postgres-15'},
          ],
        },
        meta: {},
      },
      ctx,
    )

    expect(result.history.domains.auth).to.deep.equal(['JWT-tokens', 'OAuth-flow'])
    expect(result.history.domains.database).to.deep.equal(['Postgres-15'])
  })

  it('returns head and tail previews', async () => {
    const node = createReconNode()
    const middle = 'M'.repeat(5000)
    const context = `START ${middle} END`
    const result = await node.execute({context, history: {}, meta: {}}, ctx)

    expect(result.headPreview.startsWith('START ')).to.be.true
    expect(result.tailPreview.endsWith(' END')).to.be.true
  })

  it('output passes the recon slot output schema', async () => {
    const node = createReconNode()
    const result = await node.execute(
      {context: 'short', history: {}, meta: {}},
      ctx,
    )

    const parsed = slotContracts.recon.outputSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`output rejected by schema: ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it('declares the recon slot type', () => {
    const node = createReconNode()
    expect(node.slot).to.equal('recon')
  })
})
