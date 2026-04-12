import {expect} from 'chai'
import sinon from 'sinon'

import type {ContributorContext} from '../../../../../src/agent/core/domain/system-prompt/types.js'
import type {ISwarmCoordinator, ProviderInfo} from '../../../../../src/agent/core/interfaces/i-swarm-coordinator.js'

import {SwarmStateContributor} from '../../../../../src/agent/infra/system-prompt/contributors/swarm-state-contributor.js'

function createMockCoordinator(providerOverrides?: ProviderInfo[]): ISwarmCoordinator {
  const providers: ProviderInfo[] = providerOverrides ?? []

  return {
    execute: sinon.stub().resolves({meta: {}, results: []}),
    getActiveProviders: sinon.stub().returns(providers),
    getSummary: sinon.stub().returns({
      activeCount: providers.length,
      avgLatencyMs: 50,
      learningStatus: 'cold-start',
      monthlyBudgetCents: 0,
      monthlySpendCents: 0,
      providers,
      totalCount: providers.length,
      totalQueries: 0,
    }),
    store: sinon.stub().resolves({id: '', latencyMs: 0, provider: '', success: true}),
  }
}

function makeProvider(id: string, type: string, overrides?: Partial<ProviderInfo>): ProviderInfo {
  return {
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
    id,
    type: type as 'byterover',
    ...overrides,
  }
}

describe('SwarmStateContributor', () => {
  afterEach(() => sinon.restore())

  const defaultContext: ContributorContext = {}

  it('returns empty string when only 1 provider is registered', async () => {
    const coordinator = createMockCoordinator([makeProvider('byterover', 'byterover')])
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.equal('')
  })

  it('returns empty string when no providers are registered', async () => {
    const coordinator = createMockCoordinator([])
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.equal('')
  })

  it('lists providers when more than 1 are registered', async () => {
    const coordinator = createMockCoordinator([
      makeProvider('byterover', 'byterover'),
      makeProvider('obsidian', 'obsidian'),
      makeProvider('gbrain', 'gbrain'),
    ])
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.include('byterover')
    expect(content).to.include('obsidian')
    expect(content).to.include('gbrain')
  })

  it('includes swarm-state tags in output', async () => {
    const coordinator = createMockCoordinator([
      makeProvider('byterover', 'byterover'),
      makeProvider('obsidian', 'obsidian'),
    ])
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.include('<swarm-state>')
    expect(content).to.include('</swarm-state>')
  })

  it('mentions swarm_query tool availability', async () => {
    const coordinator = createMockCoordinator([
      makeProvider('byterover', 'byterover'),
      makeProvider('obsidian', 'obsidian'),
    ])
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.include('swarm_query')
  })

  it('has correct id and priority', () => {
    const coordinator = createMockCoordinator()
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)

    expect(contributor.id).to.equal('swarmState')
    expect(contributor.priority).to.equal(17)
  })

  it('includes write guidance when writable providers exist', async () => {
    const coordinator = createMockCoordinator([
      makeProvider('byterover', 'byterover'),
      makeProvider('gbrain', 'gbrain', {capabilities: {...makeProvider('', '').capabilities, writeSupported: true}}),
    ])
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.include('swarm_store')
    expect(content).to.include('gbrain')
    expect(content).to.include('entities')
  })

  it('omits write guidance when all providers are read-only', async () => {
    const coordinator = createMockCoordinator([
      makeProvider('byterover', 'byterover'),
      makeProvider('obsidian', 'obsidian'),
    ])
    const contributor = new SwarmStateContributor('swarmState', 17, coordinator)
    const content = await contributor.getContent(defaultContext)

    expect(content).to.not.include('swarm_store')
    expect(content).to.not.include('Writing Knowledge')
  })
})
