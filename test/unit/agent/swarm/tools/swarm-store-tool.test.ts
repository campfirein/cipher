import {expect} from 'chai'
import sinon from 'sinon'

import type {ISwarmCoordinator, SwarmStoreResult} from '../../../../../src/agent/core/interfaces/i-swarm-coordinator.js'

import {createSwarmStoreTool} from '../../../../../src/agent/infra/tools/implementations/swarm-store-tool.js'

function createMockCoordinator(): ISwarmCoordinator {
  const storeResult: SwarmStoreResult = {
    id: 'concept/test',
    latencyMs: 50,
    provider: 'gbrain',
    success: true,
  }

  return {
    execute: sinon.stub().resolves({meta: {}, results: []}),
    getActiveProviders: sinon.stub().returns([]),
    getSummary: sinon.stub().returns({
      activeCount: 1,
      avgLatencyMs: 50,
      learningStatus: 'cold-start',
      monthlyBudgetCents: 0,
      monthlySpendCents: 0,
      providers: [],
      totalCount: 1,
      totalQueries: 0,
    }),
    store: sinon.stub().resolves(storeResult),
  }
}

describe('SwarmStoreTool', () => {
  afterEach(() => sinon.restore())

  it('has correct tool id', () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmStoreTool(coordinator)
    expect(tool.id).to.equal('swarm_store')
  })

  it('has a description', () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmStoreTool(coordinator)
    expect(tool.description).to.be.a('string')
    expect(tool.description.length).to.be.greaterThan(0)
  })

  it('has an input schema', () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmStoreTool(coordinator)
    expect(tool.inputSchema).to.exist
  })

  it('delegates to coordinator.store()', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmStoreTool(coordinator)

    const result = await tool.execute({content: 'Test knowledge'})

    expect((coordinator.store as sinon.SinonStub).calledOnce).to.be.true
    expect(result).to.have.property('success', true)
    expect(result).to.have.property('provider', 'gbrain')
  })

  it('passes provider override', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmStoreTool(coordinator)

    await tool.execute({content: 'Test', provider: 'local-markdown:notes'})

    const call = (coordinator.store as sinon.SinonStub).firstCall
    expect(call.args[0].provider).to.equal('local-markdown:notes')
  })

  it('passes contentType hint as WriteType', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmStoreTool(coordinator)

    await tool.execute({content: 'Test', contentType: 'entity'})

    const call = (coordinator.store as sinon.SinonStub).firstCall
    expect(call.args[0].contentType).to.equal('entity')
  })

  it('validates input schema', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmStoreTool(coordinator)

    try {
      await tool.execute({})
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.exist
    }
  })
})
