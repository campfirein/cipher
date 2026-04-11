import {expect} from 'chai'
import sinon from 'sinon'

import type {QueryResult} from '../../../../src/agent/core/domain/swarm/types.js'
import type {IMemoryProvider} from '../../../../src/agent/core/interfaces/i-memory-provider.js'
import type {SwarmConfig} from '../../../../src/agent/infra/swarm/config/swarm-config-schema.js'

import {SwarmCoordinator} from '../../../../src/agent/infra/swarm/swarm-coordinator.js'

function createMockProvider(id: string, type: string, results: QueryResult[]): IMemoryProvider {
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
    delete: sinon.stub(),
    estimateCost: sinon.stub().returns({estimatedCostCents: 0, estimatedLatencyMs: 50, estimatedTokens: 0}),
    healthCheck: sinon.stub().resolves({available: true}),
    id,
    query: sinon.stub().resolves(results),
    store: sinon.stub(),
    type: type as 'byterover',
    update: sinon.stub(),
  }
}

function makeResult(provider: string, content: string): QueryResult {
  return {
    content,
    id: `${provider}-1`,
    metadata: {matchType: 'keyword', source: `${content}.md`},
    provider,
    score: 0.8,
  }
}

function createMinimalConfig(overrides?: Partial<SwarmConfig>): SwarmConfig {
  return {
    enrichment: {edges: []},
    optimization: {
      edgeLearning: {enabled: true, explorationRate: 0.05, fixThreshold: 0.95, minObservationsToPrune: 100, pruneThreshold: 0.05},
      templateOptimization: {abTestSize: 5, enabled: true, failureRateTrigger: 0.3, frequency: 20},
    },
    performance: {
      fileWatcherDebounceMs: 1000,
      indexCacheTtlSeconds: 300,
      maxConcurrentProviders: 4,
      maxQueryLatencyMs: 2000,
    },
    provenance: {enabled: true, fullRetentionDays: 30, keepSummaries: true, storagePath: 'swarm/provenance'},
    providers: {byterover: {enabled: true}},
    routing: {classificationMethod: 'auto', defaultMaxResults: 10, defaultStrategy: 'adaptive', rrfK: 60},
    ...overrides,
  }
}

describe('SwarmCoordinator', () => {
  afterEach(() => sinon.restore())

  describe('execute()', () => {
    it('routes, executes, and merges results from providers', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Auth design')])
      const p2 = createMockProvider('obsidian', 'obsidian', [makeResult('obsidian', 'Token rotation')])
      const config = createMinimalConfig()

      const coordinator = new SwarmCoordinator([p1, p2], config)
      const result = await coordinator.execute({query: 'auth tokens'})

      expect(result.results.length).to.be.greaterThan(0)
      expect(result.meta.queryType).to.equal('factual')
      expect(result.meta.totalLatencyMs).to.be.a('number')
      expect(result.meta.costCents).to.be.a('number')
    })

    it('classifies temporal queries and routes accordingly', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Recent change')])
      const config = createMinimalConfig()

      const coordinator = new SwarmCoordinator([p1], config)
      const result = await coordinator.execute({query: 'what changed yesterday'})

      expect(result.meta.queryType).to.equal('temporal')
    })

    it('returns per-provider metadata', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Result')])
      const config = createMinimalConfig()

      const coordinator = new SwarmCoordinator([p1], config)
      const result = await coordinator.execute({query: 'test'})

      expect(result.meta.providers).to.have.property('byterover')
      expect(result.meta.providers.byterover.latencyMs).to.be.a('number')
      expect(result.meta.providers.byterover.resultCount).to.equal(1)
    })

    it('respects maxResults from config', async () => {
      const results: QueryResult[] = []
      for (let i = 0; i < 20; i++) {
        results.push(makeResult('byterover', `Result ${i}`))
      }

      const p1 = createMockProvider('byterover', 'byterover', results)
      const config = createMinimalConfig({
        routing: {classificationMethod: 'auto', defaultMaxResults: 5, defaultStrategy: 'adaptive', rrfK: 60},
      })

      const coordinator = new SwarmCoordinator([p1], config)
      const result = await coordinator.execute({query: 'test'})

      expect(result.results.length).to.be.at.most(5)
    })

    it('handles empty provider list gracefully', async () => {
      const config = createMinimalConfig()
      const coordinator = new SwarmCoordinator([], config)
      const result = await coordinator.execute({query: 'test'})

      expect(result.results).to.have.length(0)
      expect(result.meta.totalLatencyMs).to.be.a('number')
    })

    it('skips unhealthy providers during execute', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Result')])
      const p2 = createMockProvider('obsidian', 'obsidian', [makeResult('obsidian', 'Obsidian result')]);
      (p2.healthCheck as sinon.SinonStub).resolves({available: false, error: 'Vault not found'})

      const config = createMinimalConfig()
      const coordinator = new SwarmCoordinator([p1, p2], config)

      // Mark obsidian as unhealthy
      await coordinator.refreshHealth()

      const result = await coordinator.execute({query: 'test'})

      // Obsidian should NOT have been queried
      expect((p2.query as sinon.SinonStub).called).to.be.false
      // Only byterover results should be present
      expect(result.meta.providers).to.not.have.property('obsidian')
      expect(result.meta.providers).to.have.property('byterover')
    })

    it('sums cost estimates from all providers', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Result')])
      const p2 = createMockProvider('obsidian', 'obsidian', [makeResult('obsidian', 'Result')]);
      (p2.estimateCost as sinon.SinonStub).returns({estimatedCostCents: 5, estimatedLatencyMs: 100, estimatedTokens: 100})

      const config = createMinimalConfig()
      const coordinator = new SwarmCoordinator([p1, p2], config)
      const result = await coordinator.execute({query: 'test'})

      expect(result.meta.costCents).to.be.a('number')
    })
  })

  describe('getActiveProviders()', () => {
    it('returns provider info with cached health status', () => {
      const p1 = createMockProvider('byterover', 'byterover', [])
      const p2 = createMockProvider('obsidian', 'obsidian', [])

      const config = createMinimalConfig()
      const coordinator = new SwarmCoordinator([p1, p2], config)

      // Before refreshHealth, all are assumed healthy
      const providers = coordinator.getActiveProviders()

      expect(providers).to.have.length(2)
      expect(providers.find((p) => p.id === 'byterover')?.healthy).to.be.true
      expect(providers.find((p) => p.id === 'obsidian')?.healthy).to.be.true
    })

    it('reflects updated health after refreshHealth()', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [])
      const p2 = createMockProvider('obsidian', 'obsidian', []);
      (p2.healthCheck as sinon.SinonStub).resolves({available: false, error: 'Vault not found'})

      const config = createMinimalConfig()
      const coordinator = new SwarmCoordinator([p1, p2], config)

      await coordinator.refreshHealth()
      const providers = coordinator.getActiveProviders()

      expect(providers.find((p) => p.id === 'byterover')?.healthy).to.be.true
      expect(providers.find((p) => p.id === 'obsidian')?.healthy).to.be.false
    })
  })

  describe('enrichment edges from config', () => {
    it('passes enrichment edges from config to graph execution', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Structured data')])
      const p2 = createMockProvider('obsidian', 'obsidian', [makeResult('obsidian', 'Vault data')])

      const config = createMinimalConfig({
        enrichment: {edges: [{from: 'byterover', to: 'obsidian'}]},
      })
      const coordinator = new SwarmCoordinator([p1, p2], config)
      const result = await coordinator.execute({query: 'test'})

      // Obsidian should show enrichedBy in metadata
      expect(result.meta.providers.obsidian?.enrichedBy).to.include('byterover')
    })

    it('expands generic local-markdown edge to concrete provider IDs', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Context data')])
      // LocalMarkdownAdapter produces IDs like local-markdown:notes
      const p2 = createMockProvider('local-markdown:notes', 'local-markdown', [makeResult('local-markdown:notes', 'Notes data')])

      const config = createMinimalConfig({
        // Config uses generic "local-markdown" — must be expanded to "local-markdown:notes"
        enrichment: {edges: [{from: 'byterover', to: 'local-markdown'}]},
      })
      const coordinator = new SwarmCoordinator([p1, p2], config)
      const result = await coordinator.execute({query: 'test'})

      // local-markdown:notes should show enrichedBy despite config saying "local-markdown"
      expect(result.meta.providers['local-markdown:notes']?.enrichedBy).to.include('byterover')
    })

    it('deduplicates overlapping generic and specific edges', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Data')])
      const p2 = createMockProvider('local-markdown:notes', 'local-markdown', [makeResult('local-markdown:notes', 'Notes')])

      const config = createMinimalConfig({
        // Both edges resolve to the same concrete edge: byterover → local-markdown:notes
        enrichment: {edges: [
          {from: 'byterover', to: 'local-markdown'},
          {from: 'byterover', to: 'local-markdown:notes'},
        ]},
      })
      const coordinator = new SwarmCoordinator([p1, p2], config)
      const result = await coordinator.execute({query: 'test'})

      // Should NOT have duplicate enrichment — byterover should appear once in enrichedBy
      const enrichedBy = result.meta.providers['local-markdown:notes']?.enrichedBy ?? ''
      const occurrences = enrichedBy.split(',').filter((s) => s === 'byterover')
      expect(occurrences).to.have.length(1)
    })

    it('detects cycles introduced by expansion and skips edges', async () => {
      // Config: local-markdown → obsidian, obsidian → local-markdown:notes
      // After expansion: local-markdown:notes → obsidian, obsidian → local-markdown:notes (cycle!)
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Data')])
      const p2 = createMockProvider('obsidian', 'obsidian', [makeResult('obsidian', 'Vault')])
      const p3 = createMockProvider('local-markdown:notes', 'local-markdown', [makeResult('local-markdown:notes', 'Notes')])

      const config = createMinimalConfig({
        enrichment: {edges: [
          {from: 'local-markdown', to: 'obsidian'},
          {from: 'obsidian', to: 'local-markdown:notes'},
        ]},
      })
      const coordinator = new SwarmCoordinator([p1, p2, p3], config)
      const result = await coordinator.execute({query: 'test'})

      // All providers should still return results (cycle detected → edges dropped)
      expect(result.results.length).to.be.greaterThan(0)
      // Neither provider in the cycle should show enrichedBy (edges were dropped)
      expect(result.meta.providers.obsidian?.enrichedBy).to.be.undefined
      expect(result.meta.providers['local-markdown:notes']?.enrichedBy).to.be.undefined
    })

    it('works without enrichment config (all parallel)', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [makeResult('byterover', 'Result')])
      const p2 = createMockProvider('obsidian', 'obsidian', [makeResult('obsidian', 'Result')])

      const config = createMinimalConfig()
      const coordinator = new SwarmCoordinator([p1, p2], config)
      const result = await coordinator.execute({query: 'test'})

      // No enrichedBy when no edges configured
      expect(result.meta.providers.byterover?.enrichedBy).to.be.undefined
      expect(result.meta.providers.obsidian?.enrichedBy).to.be.undefined
    })
  })

  describe('getSummary()', () => {
    it('returns a summary with provider counts', async () => {
      const p1 = createMockProvider('byterover', 'byterover', [])
      const config = createMinimalConfig({
        budget: {globalMonthlyCapCents: 5000, warningThresholdPct: 80, weightReductionThresholdPct: 90},
      })

      const coordinator = new SwarmCoordinator([p1], config)
      const summary = coordinator.getSummary()

      expect(summary.totalCount).to.equal(1)
      expect(summary.activeCount).to.equal(1)
      expect(summary.monthlyBudgetCents).to.equal(5000)
      expect(summary.providers).to.have.length(1)
    })
  })
})
