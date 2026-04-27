import {expect} from 'chai'
import {stub} from 'sinon'

import type {NodeContext} from '../../../../../src/agent/core/curation/flow/runner.js'

import {slotContracts} from '../../../../../src/agent/core/curation/flow/slots/contracts.js'
import {createConflictNode} from '../../../../../src/agent/infra/curation/flow/nodes/conflict-node.js'

describe('conflictNode', () => {
  it('delegates to services.detectConflicts with deduped facts only (no ctx existing param)', async () => {
    const detectStub = stub().resolves({
      decisions: [
        {action: 'add', fact: {statement: 'JWT expires', subject: 'auth'}},
      ],
    })

    const ctx: NodeContext = {
      services: {detectConflicts: detectStub},
      taskId: 't',
    }

    const node = createConflictNode()
    const result = await node.execute(
      {deduped: [{statement: 'JWT expires', subject: 'auth'}]},
      ctx,
    )

    // detectConflicts is single-arg (facts). The service is responsible
    // for sourcing existing memory itself — see runner.ts NodeServices.
    expect(detectStub.calledOnce).to.be.true
    expect(detectStub.firstCall.args).to.have.length(1)
    expect(detectStub.firstCall.args[0]).to.deep.equal([
      {statement: 'JWT expires', subject: 'auth'},
    ])
    expect(result.decisions).to.have.length(1)
    expect(result.decisions[0].action).to.equal('add')
  })

  it('fail-open: when service throws, returns add-only decisions for every fact', async () => {
    const detectStub = stub().rejects(new Error('LLM unavailable'))

    const ctx: NodeContext = {
      services: {detectConflicts: detectStub},
      taskId: 't',
    }

    const node = createConflictNode()
    const result = await node.execute(
      {
        deduped: [
          {statement: 'A', subject: 'x'},
          {statement: 'B', subject: 'y'},
        ],
      },
      ctx,
    )

    expect(result.decisions).to.have.length(2)
    expect(result.decisions.every((d) => d.action === 'add')).to.be.true
  })

  it('returns empty decisions for empty deduped input (no service call)', async () => {
    const detectStub = stub().resolves({decisions: []})

    const ctx: NodeContext = {
      services: {detectConflicts: detectStub},
      taskId: 't',
    }

    const node = createConflictNode()
    const result = await node.execute({deduped: []}, ctx)

    expect(detectStub.called).to.be.false
    expect(result.decisions).to.deep.equal([])
  })

  it('throws a clear error when services.detectConflicts is not provided AND there are facts', async () => {
    const ctx: NodeContext = {taskId: 't'}
    const node = createConflictNode()

    let thrown: Error | undefined
    try {
      await node.execute({deduped: [{statement: 'fact', subject: 'x'}]}, ctx)
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).to.exist
    expect(thrown?.message).to.match(/detectConflicts|conflict/i)
  })

  it('output passes the conflict slot output schema', async () => {
    const detectStub = stub().resolves({
      decisions: [{action: 'add', fact: {statement: 'X', subject: 'y'}}],
    })

    const ctx: NodeContext = {services: {detectConflicts: detectStub}, taskId: 't'}
    const node = createConflictNode()
    const result = await node.execute({deduped: [{statement: 'X', subject: 'y'}]}, ctx)

    const parsed = slotContracts.conflict.outputSchema.safeParse(result)
    if (!parsed.success) {
      throw new Error(`output rejected by schema: ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it('declares the conflict slot type', () => {
    const node = createConflictNode()
    expect(node.slot).to.equal('conflict')
  })
})
