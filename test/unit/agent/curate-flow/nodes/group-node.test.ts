import {expect} from 'chai'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createGroupNode} from '../../../../../src/agent/infra/curation/flow/nodes/group-node.js'

const ctx: NodeContext = {taskId: 'test-task'}

type CurationCategory =
  | 'convention'
  | 'environment'
  | 'other'
  | 'personal'
  | 'preference'
  | 'project'
  | 'team'

interface FactFixture {
  category?: CurationCategory
  statement: string
  subject?: string
}

// Group's input is now extract's full output shape.
function extractOutput(facts: FactFixture[]): {
  facts: FactFixture[]
  failed: number
  succeeded: number
  total: number
} {
  return {facts, failed: 0, succeeded: facts.length, total: facts.length}
}

describe('groupNode', () => {
  it('groups facts by subject', async () => {
    const node = createGroupNode()
    const result = await node.execute(
      extractOutput([
        {statement: 'JWT expires in 24h', subject: 'auth'},
        {statement: 'Refresh tokens rotate', subject: 'auth'},
        {statement: 'PostgreSQL 15', subject: 'database'},
      ]),
      ctx,
    )

    expect(result.grouped.auth).to.have.length(2)
    expect(result.grouped.database).to.have.length(1)
  })

  it('uses category when subject is missing', async () => {
    const node = createGroupNode()
    const result = await node.execute(
      extractOutput([{category: 'environment', statement: 'Node 22'}]),
      ctx,
    )

    expect(result.grouped.environment).to.have.length(1)
  })

  it('falls back to "uncategorized" when both subject and category are missing', async () => {
    const node = createGroupNode()
    const result = await node.execute(extractOutput([{statement: 'orphan fact'}]), ctx)

    expect(result.grouped.uncategorized).to.have.length(1)
  })

  it('returns empty grouping for empty input', async () => {
    const node = createGroupNode()
    const result = await node.execute(extractOutput([]), ctx)

    expect(Object.keys(result.grouped)).to.have.length(0)
  })

  it('output passes the group slot output schema', async () => {
    const node = createGroupNode()
    const result = await node.execute(
      extractOutput([{statement: 'JWT expires', subject: 'auth'}]),
      ctx,
    )

    const parsed = slotContracts.group.outputSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`output rejected by schema: ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it('declares the group slot type', () => {
    const node = createGroupNode()
    expect(node.slot).to.equal('group')
  })
})
