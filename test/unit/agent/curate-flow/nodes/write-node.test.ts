import {expect} from 'chai'
import {stub} from 'sinon'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createWriteNode} from '../../../../../src/agent/infra/curation/flow/nodes/write-node.js'

describe('writeNode', () => {
  it('delegates to services.write and returns applied + summary', async () => {
    const writeStub = stub().resolves({
      applied: [
        {
          confidence: 'high',
          impact: 'low',
          needsReview: false,
          path: 'auth/jwt.md',
          reason: 'Documenting JWT',
          status: 'success',
          type: 'ADD',
        },
      ],
      summary: {added: 1, deleted: 0, failed: 0, merged: 0, updated: 0},
    })

    const ctx: NodeContext = {
      services: {write: writeStub},
      taskId: 't',
    }

    const node = createWriteNode()
    const result = await node.execute(
      {decisions: [{action: 'add', fact: {statement: 'JWT expires', subject: 'auth'}}]},
      ctx,
    )

    expect(writeStub.calledOnce).to.be.true
    expect(result.applied).to.have.length(1)
    expect(result.summary.added).to.equal(1)
  })

  it('partial failure: surfaces failed counts in summary', async () => {
    const writeStub = stub().resolves({
      applied: [
        {
          confidence: 'high',
          impact: 'low',
          needsReview: false,
          path: 'auth/jwt.md',
          reason: 'ok',
          status: 'success',
          type: 'ADD',
        },
        {
          confidence: 'low',
          impact: 'low',
          needsReview: false,
          path: 'auth/oauth.md',
          reason: 'duplicate path',
          status: 'failed',
          type: 'ADD',
        },
      ],
      summary: {added: 1, deleted: 0, failed: 1, merged: 0, updated: 0},
    })

    const ctx: NodeContext = {services: {write: writeStub}, taskId: 't'}
    const node = createWriteNode()
    const result = await node.execute(
      {
        decisions: [
          {action: 'add', fact: {statement: 'A', subject: 'auth'}},
          {action: 'add', fact: {statement: 'B', subject: 'auth'}},
        ],
      },
      ctx,
    )

    expect(result.summary.failed).to.equal(1)
    expect(result.applied).to.have.length(2)
  })

  it('short-circuits empty decisions without calling the service', async () => {
    const writeStub = stub().resolves({
      applied: [],
      summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
    })

    const ctx: NodeContext = {services: {write: writeStub}, taskId: 't'}
    const node = createWriteNode()
    const result = await node.execute({decisions: []}, ctx)

    expect(writeStub.called).to.be.false
    expect(result.applied).to.deep.equal([])
    expect(result.summary.added).to.equal(0)
  })

  it('throws when services.write is not provided AND there are decisions to apply', async () => {
    const ctx: NodeContext = {taskId: 't'}
    const node = createWriteNode()

    let thrown: Error | undefined
    try {
      await node.execute(
        {decisions: [{action: 'add', fact: {statement: 'X', subject: 'y'}}]},
        ctx,
      )
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).to.exist
    expect(thrown?.message).to.match(/write/i)
  })

  it('output passes the write slot output schema', async () => {
    const writeStub = stub().resolves({
      applied: [],
      summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
    })

    const ctx: NodeContext = {services: {write: writeStub}, taskId: 't'}
    const node = createWriteNode()
    const result = await node.execute({decisions: []}, ctx)

    const parsed = slotContracts.write.outputSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`output rejected by schema: ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it('declares the write slot type', () => {
    const node = createWriteNode()
    expect(node.slot).to.equal('write')
  })
})
