import {expect} from 'chai'
import sinon from 'sinon'

import type {ISwarmCoordinator, SwarmQueryResult} from '../../../../../src/agent/core/interfaces/i-swarm-coordinator.js'

import {createSwarmQueryTool} from '../../../../../src/agent/infra/tools/implementations/swarm-query-tool.js'

function createMockCoordinator(result?: Partial<SwarmQueryResult>): ISwarmCoordinator {
  const defaultResult: SwarmQueryResult = {
    meta: {
      costCents: 0,
      providers: {byterover: {latencyMs: 30, resultCount: 1, selected: true}},
      queryType: 'factual',
      totalLatencyMs: 35,
    },
    results: [
      {
        content: 'Auth tokens use JWT.',
        id: 'brv-0',
        metadata: {matchType: 'keyword', source: 'auth/jwt/context.md'},
        provider: 'byterover',
        providerType: 'byterover',
        score: 0.9,
      },
    ],
    ...result,
  }

  return {
    execute: sinon.stub().resolves(defaultResult),
    getActiveProviders: sinon.stub().returns([
      {
        capabilities: {
          avgLatencyMs: 50,
          graphTraversal: false,
          keywordSearch: true,
          localOnly: true,
          maxTokensPerQuery: 8000,
          semanticSearch: false,
          temporalQuery: false,
          userModeling: false,
          writeSupported: false,
        },
        healthy: true,
        id: 'byterover',
        type: 'byterover' as const,
      },
    ]),
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
    store: sinon.stub().resolves({id: '', latencyMs: 0, provider: '', success: true}),
  }
}

describe('SwarmQueryTool', () => {
  afterEach(() => sinon.restore())

  it('has correct tool id', () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmQueryTool(coordinator)

    expect(tool.id).to.equal('swarm_query')
  })

  it('has a description', () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmQueryTool(coordinator)

    expect(tool.description).to.be.a('string')
    expect(tool.description.length).to.be.greaterThan(0)
  })

  it('has an input schema', () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmQueryTool(coordinator)

    expect(tool.inputSchema).to.exist
  })

  it('executes a query and returns results', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmQueryTool(coordinator)

    const result = await tool.execute({query: 'auth tokens'})

    expect((coordinator.execute as sinon.SinonStub).calledOnce).to.be.true
    expect(result).to.have.property('results')
    expect(result).to.have.property('meta')
  })

  it('validates input schema', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmQueryTool(coordinator)

    try {
      await tool.execute({})
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.exist
    }
  })

  it('passes maxResults to coordinator', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmQueryTool(coordinator)

    await tool.execute({maxResults: 5, query: 'test'})

    const call = (coordinator.execute as sinon.SinonStub).firstCall
    expect(call.args[0].maxResults).to.equal(5)
  })

  it('passes scope to coordinator', async () => {
    const coordinator = createMockCoordinator()
    const tool = createSwarmQueryTool(coordinator)

    await tool.execute({query: 'test', scope: 'auth'})

    const call = (coordinator.execute as sinon.SinonStub).firstCall
    expect(call.args[0].scope).to.equal('auth')
  })
})
