import {expect} from 'chai'
import sinon from 'sinon'

import type {QueryRequest, QueryResult} from '../../../../src/agent/core/domain/swarm/types.js'
import type {IMemoryProvider} from '../../../../src/agent/core/interfaces/i-memory-provider.js'

import {SwarmGraph} from '../../../../src/agent/infra/swarm/swarm-graph.js'

function createMockProvider(id: string, results: QueryResult[], latencyMs = 10): IMemoryProvider {
  return {
    capabilities: {
      avgLatencyMs: latencyMs,
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
    estimateCost: sinon.stub().returns({estimatedCostCents: 0, estimatedLatencyMs: latencyMs, estimatedTokens: 0}),
    healthCheck: sinon.stub().resolves({available: true}),
    id,
    query: sinon.stub().resolves(results),
    store: sinon.stub(),
    type: 'byterover',
    update: sinon.stub(),
  }
}

function makeResult(provider: string, content: string): QueryResult {
  return {
    content,
    id: `${provider}-1`,
    metadata: {matchType: 'keyword', source: `${content}.md`},
    provider,
    providerType: 'byterover',
    score: 0.8,
  }
}

describe('SwarmGraph', () => {
  afterEach(() => sinon.restore())

  it('executes providers in parallel at level 0', async () => {
    const p1 = createMockProvider('p1', [makeResult('p1', 'Result A')])
    const p2 = createMockProvider('p2', [makeResult('p2', 'Result B')])

    const graph = new SwarmGraph([p1, p2])
    const request: QueryRequest = {query: 'test'}
    const results = await graph.execute(request, ['p1', 'p2'])

    expect(results.has('p1')).to.be.true
    expect(results.has('p2')).to.be.true
    expect(results.get('p1')).to.have.length(1)
    expect(results.get('p2')).to.have.length(1)
  })

  it('skips providers not in the active list', async () => {
    const p1 = createMockProvider('p1', [makeResult('p1', 'Result A')])
    const p2 = createMockProvider('p2', [makeResult('p2', 'Result B')])

    const graph = new SwarmGraph([p1, p2])
    const results = await graph.execute({query: 'test'}, ['p1'])

    expect(results.has('p1')).to.be.true
    expect(results.has('p2')).to.be.false
  })

  it('handles provider errors gracefully (returns empty for that provider)', async () => {
    const p1 = createMockProvider('p1', [makeResult('p1', 'Result A')])
    const p2 = createMockProvider('p2', []);
    (p2.query as sinon.SinonStub).rejects(new Error('Connection failed'))

    const graph = new SwarmGraph([p1, p2])
    const results = await graph.execute({query: 'test'}, ['p1', 'p2'])

    expect(results.get('p1')).to.have.length(1)
    expect(results.get('p2')).to.have.length(0)
  })

  it('respects timeout (slow providers return empty)', async () => {
    const fast = createMockProvider('fast', [makeResult('fast', 'Fast result')])
    const slow = createMockProvider('slow', []);
    (slow.query as sinon.SinonStub).callsFake(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 500) })

      return [makeResult('slow', 'Slow result')]
    })

    const graph = new SwarmGraph([fast, slow], {timeoutMs: 100})
    const results = await graph.execute({query: 'test'}, ['fast', 'slow'])

    expect(results.get('fast')).to.have.length(1)
    // Slow provider should have been timed out
    expect(results.get('slow')).to.have.length(0)
  })

  it('returns per-provider latency metadata', async () => {
    const p1 = createMockProvider('p1', [makeResult('p1', 'Result')])

    const graph = new SwarmGraph([p1])
    await graph.execute({query: 'test'}, ['p1'])
    const meta = graph.getLastExecutionMeta()

    expect(meta).to.exist
    expect(meta!.providers.p1).to.exist
    expect(meta!.providers.p1.latencyMs).to.be.a('number')
    expect(meta!.providers.p1.resultCount).to.equal(1)
  })

  describe('enrichment chains', () => {
    it('passes level-0 results as enrichment to level-1 providers', async () => {
      const level0 = createMockProvider('p0', [makeResult('p0', 'Auth tokens')])
      const level1 = createMockProvider('p1', [makeResult('p1', 'Enriched result')]);

      // Verify level-1 provider receives enrichment from level-0
      (level1.query as sinon.SinonStub).callsFake(async (req: QueryRequest) => {
        // Should have enrichment data from level-0
        expect(req.enrichment).to.exist
        expect(req.enrichment!.excerpts).to.include('Auth tokens')

        return [makeResult('p1', 'Enriched result')]
      })

      const graph = new SwarmGraph([level0, level1])
      graph.setEnrichmentEdges([{from: 'p0', to: 'p1'}])

      const results = await graph.execute({query: 'test'}, ['p0', 'p1'])

      expect(results.get('p0')).to.have.length(1)
      expect(results.get('p1')).to.have.length(1)
      // Level-1 should have been called after level-0
      expect((level1.query as sinon.SinonStub).calledOnce).to.be.true
    })

    it('records enrichedBy in metadata for enriched providers', async () => {
      const level0 = createMockProvider('p0', [makeResult('p0', 'Source')])
      const level1 = createMockProvider('p1', [makeResult('p1', 'Target')])

      const graph = new SwarmGraph([level0, level1])
      graph.setEnrichmentEdges([{from: 'p0', to: 'p1'}])

      await graph.execute({query: 'test'}, ['p0', 'p1'])
      const meta = graph.getLastExecutionMeta()

      expect(meta?.providers.p1.enrichedBy).to.equal('p0')
    })

    it('level-0 providers without edges run in parallel', async () => {
      const p0a = createMockProvider('p0a', [makeResult('p0a', 'A')])
      const p0b = createMockProvider('p0b', [makeResult('p0b', 'B')])
      const p1 = createMockProvider('p1', [makeResult('p1', 'C')])

      const graph = new SwarmGraph([p0a, p0b, p1])
      graph.setEnrichmentEdges([{from: 'p0a', to: 'p1'}])

      const results = await graph.execute({query: 'test'}, ['p0a', 'p0b', 'p1'])

      expect(results.get('p0a')).to.have.length(1)
      expect(results.get('p0b')).to.have.length(1)
      expect(results.get('p1')).to.have.length(1)
    })

    it('supports multi-hop chains A→B→C across three levels', async () => {
      const pA = createMockProvider('pA', [makeResult('pA', 'Root data')])
      const pB = createMockProvider('pB', [makeResult('pB', 'Middle data')])
      const pC = createMockProvider('pC', [makeResult('pC', 'Leaf data')])

      const executionOrder: string[] = [];
      (pA.query as sinon.SinonStub).callsFake(async () => {
        executionOrder.push('pA')

        return [makeResult('pA', 'Root data')]
      });
      (pB.query as sinon.SinonStub).callsFake(async (req: QueryRequest) => {
        executionOrder.push('pB')
        expect(req.enrichment?.excerpts).to.include('Root data')

        return [makeResult('pB', 'Middle data')]
      });
      (pC.query as sinon.SinonStub).callsFake(async (req: QueryRequest) => {
        executionOrder.push('pC')
        expect(req.enrichment?.excerpts).to.include('Middle data')

        return [makeResult('pC', 'Leaf data')]
      })

      const graph = new SwarmGraph([pA, pB, pC])
      graph.setEnrichmentEdges([{from: 'pA', to: 'pB'}, {from: 'pB', to: 'pC'}])

      const results = await graph.execute({query: 'test'}, ['pA', 'pB', 'pC'])

      expect(results.get('pA')).to.have.length(1)
      expect(results.get('pB')).to.have.length(1)
      expect(results.get('pC')).to.have.length(1)
      // Execution order must respect the chain
      expect(executionOrder.indexOf('pA')).to.be.lessThan(executionOrder.indexOf('pB'))
      expect(executionOrder.indexOf('pB')).to.be.lessThan(executionOrder.indexOf('pC'))
    })

    it('fan-in merges enrichment from ALL predecessors', async () => {
      const pA = createMockProvider('pA', [makeResult('pA', 'Source A')])
      const pB = createMockProvider('pB', [makeResult('pB', 'Source B')])
      const pC = createMockProvider('pC', [makeResult('pC', 'Fan-in result')]);

      (pC.query as sinon.SinonStub).callsFake(async (req: QueryRequest) => {
        // Must receive excerpts from BOTH predecessors
        expect(req.enrichment).to.exist
        expect(req.enrichment!.excerpts).to.include('Source A')
        expect(req.enrichment!.excerpts).to.include('Source B')

        return [makeResult('pC', 'Fan-in result')]
      })

      const graph = new SwarmGraph([pA, pB, pC])
      graph.setEnrichmentEdges([{from: 'pA', to: 'pC'}, {from: 'pB', to: 'pC'}])

      const results = await graph.execute({query: 'test'}, ['pA', 'pB', 'pC'])

      expect(results.get('pA')).to.have.length(1)
      expect(results.get('pB')).to.have.length(1)
      expect(results.get('pC')).to.have.length(1)

      const meta = graph.getLastExecutionMeta()
      // pC should list all predecessors
      expect(meta?.providers.pC.enrichedBy).to.include('pA')
      expect(meta?.providers.pC.enrichedBy).to.include('pB')
    })

    it('providers not in active list are skipped even if they have edges', async () => {
      const p0 = createMockProvider('p0', [makeResult('p0', 'A')])
      const p1 = createMockProvider('p1', [makeResult('p1', 'B')])

      const graph = new SwarmGraph([p0, p1])
      graph.setEnrichmentEdges([{from: 'p0', to: 'p1'}])

      // Only activate p0, not p1
      const results = await graph.execute({query: 'test'}, ['p0'])

      expect(results.get('p0')).to.have.length(1)
      expect(results.has('p1')).to.be.false
    })
  })

  it('returns empty map for empty active providers', async () => {
    const graph = new SwarmGraph([])
    const results = await graph.execute({query: 'test'}, [])

    expect(results.size).to.equal(0)
  })
})
