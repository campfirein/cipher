import {expect} from 'chai'
import sinon from 'sinon'

import type {QueryRequest} from '../../../../../src/agent/core/domain/swarm/types.js'

import {ByteRoverAdapter} from '../../../../../src/agent/infra/swarm/adapters/byterover-adapter.js'

describe('ByteRoverAdapter', () => {
  let adapter: ByteRoverAdapter
  let mockSearchService: {search: sinon.SinonStub}

  beforeEach(() => {
    mockSearchService = {
      search: sinon.stub().resolves({
        message: 'Found 2 results',
        results: [
          {excerpt: 'Auth token rotation...', path: 'auth/tokens.md', score: 0.85, title: 'Auth Tokens'},
          {excerpt: 'JWT refresh...', path: 'auth/jwt.md', score: 0.72, title: 'JWT'},
        ],
        totalFound: 2,
      }),
    }
    adapter = new ByteRoverAdapter(mockSearchService as never)
  })

  afterEach(() => {
    sinon.restore()
  })

  it('has correct id and type', () => {
    expect(adapter.id).to.equal('byterover')
    expect(adapter.type).to.equal('byterover')
  })

  it('reports correct capabilities', () => {
    expect(adapter.capabilities.keywordSearch).to.be.true
    expect(adapter.capabilities.semanticSearch).to.be.false
    expect(adapter.capabilities.localOnly).to.be.true
    expect(adapter.capabilities.writeSupported).to.be.false
  })

  it('queries the search service and normalizes results', async () => {
    const request: QueryRequest = {maxResults: 10, query: 'auth tokens'}
    const results = await adapter.query(request)

    expect(mockSearchService.search.calledOnce).to.be.true
    expect(results).to.have.length(2)
    expect(results[0].provider).to.equal('byterover')
    expect(results[0].content).to.equal('Auth token rotation...')
    expect(results[0].metadata.source).to.equal('auth/tokens.md')
    expect(results[0].metadata.matchType).to.equal('keyword')
    expect(results[0].score).to.be.a('number')
    expect(results[0].score).to.be.at.least(0)
    expect(results[0].score).to.be.at.most(1)
  })

  it('passes scope and limit to search service', async () => {
    const request: QueryRequest = {maxResults: 5, query: 'auth', scope: 'auth/'}
    await adapter.query(request)

    const callArgs = mockSearchService.search.firstCall.args
    expect(callArgs[0]).to.equal('auth')
    expect(callArgs[1]).to.have.property('scope', 'auth/')
    expect(callArgs[1]).to.have.property('limit', 5)
  })

  it('healthCheck returns available', async () => {
    const status = await adapter.healthCheck()
    expect(status.available).to.be.true
  })

  it('estimateCost returns zero for local provider', () => {
    const cost = adapter.estimateCost({query: 'test'})
    expect(cost.estimatedCostCents).to.equal(0)
    expect(cost.estimatedLatencyMs).to.be.a('number')
  })

  it('returns empty results when search service returns nothing', async () => {
    mockSearchService.search.resolves({message: 'No results', results: [], totalFound: 0})
    const results = await adapter.query({query: 'nonexistent'})
    expect(results).to.have.length(0)
  })
})
