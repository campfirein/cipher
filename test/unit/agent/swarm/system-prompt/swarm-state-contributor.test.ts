import {expect} from 'chai'
import sinon from 'sinon'

import type {ContributorContext} from '../../../../../src/agent/core/domain/system-prompt/types.js'
import type {ISwarmCoordinator} from '../../../../../src/agent/core/interfaces/i-swarm-coordinator.js'

import {SwarmStateContributor} from '../../../../../src/agent/infra/system-prompt/contributors/swarm-state-contributor.js'

function createMockCoordinator(providerCount: number): ISwarmCoordinator {
  const providers = []
  for (let i = 0; i < providerCount; i++) {
    providers.push({
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
      id: `provider-${i}`,
      type: 'byterover' as const,
    })
  }

  return {
    execute: sinon.stub().resolves({meta: {}, results: []}),
    getActiveProviders: sinon.stub().returns(providers),
    getSummary: sinon.stub().returns({
      activeCount: providerCount,
      avgLatencyMs: 50,
      learningStatus: 'cold-start',
      monthlyBudgetCents: 0,
      monthlySpendCents: 0,
      providers,
      totalCount: providerCount,
      totalQueries: 0,
    }),
  }
}

describe('SwarmStateContributor', () => {
  afterEach(() => sinon.restore())

  const defaultContext: ContributorContext = {}

  it('returns empty string when only 1 provider is registered', async () => {
    const coordinator = createMockCoordinator(1)
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.equal('')
  })

  it('returns empty string when no providers are registered', async () => {
    const coordinator = createMockCoordinator(0)
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.equal('')
  })

  it('lists providers when more than 1 are registered', async () => {
    const coordinator = createMockCoordinator(3)
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.include('provider-0')
    expect(content).to.include('provider-1')
    expect(content).to.include('provider-2')
  })

  it('includes swarm-state tags in output', async () => {
    const coordinator = createMockCoordinator(2)
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.include('<swarm-state>')
    expect(content).to.include('</swarm-state>')
  })

  it('mentions swarm_query tool availability', async () => {
    const coordinator = createMockCoordinator(2)
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.include('swarm_query')
  })

  it('has correct id and priority', () => {
    const coordinator = createMockCoordinator(1)
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)

    expect(contributor.id).to.equal('swarmState')
    expect(contributor.priority).to.equal(17)
  })
})
