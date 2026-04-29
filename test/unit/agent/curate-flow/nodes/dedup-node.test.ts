import {expect} from 'chai'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createDedupNode} from '../../../../../src/agent/infra/curation/flow/nodes/dedup-node.js'

const ctx: NodeContext = {taskId: 'test-task'}

describe('dedupNode', () => {
  it('collapses near-identical facts under default Jaccard threshold (0.85)', async () => {
    // Note: jaccard tokenizes by whitespace, so trailing punctuation creates
    // a different token (e.g. "hours" vs "hours."). Use word-order variants
    // that share the same token set to actually trigger the dedup.
    const node = createDedupNode()
    const result = await node.execute(
      {
        grouped: {
          auth: [
            {statement: 'JWT tokens expire after 24 hours', subject: 'auth'},
            {statement: 'after 24 hours JWT tokens expire', subject: 'auth'},
          ],
        },
      },
      ctx,
    )

    // Identical token sets → jaccard = 1.0 → collapse to one
    expect(result.deduped).to.have.length(1)
  })

  it('keeps facts with low similarity', async () => {
    const node = createDedupNode()
    const result = await node.execute(
      {
        grouped: {
          auth: [
            {statement: 'JWT expires in 24 hours', subject: 'auth'},
            {statement: 'Refresh tokens rotate weekly', subject: 'auth'},
          ],
        },
      },
      ctx,
    )

    expect(result.deduped).to.have.length(2)
  })

  it('flattens facts across all subject groups', async () => {
    const node = createDedupNode()
    const result = await node.execute(
      {
        grouped: {
          auth: [{statement: 'JWT 24h', subject: 'auth'}],
          database: [{statement: 'PostgreSQL 15', subject: 'database'}],
        },
      },
      ctx,
    )

    expect(result.deduped).to.have.length(2)
  })

  it('returns empty for empty input', async () => {
    const node = createDedupNode()
    const result = await node.execute({grouped: {}}, ctx)

    expect(result.deduped).to.deep.equal([])
  })

  it('output passes the dedup slot output schema', async () => {
    const node = createDedupNode()
    const result = await node.execute(
      {grouped: {auth: [{statement: 'JWT 24h', subject: 'auth'}]}},
      ctx,
    )

    const parsed = slotContracts.dedup.outputSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`output rejected by schema: ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it('declares the dedup slot type', () => {
    const node = createDedupNode()
    expect(node.slot).to.equal('dedup')
  })
})
