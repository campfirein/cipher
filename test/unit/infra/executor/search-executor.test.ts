import {expect} from 'chai'
import sinon from 'sinon'

import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

import {SearchExecutor} from '../../../../src/server/infra/executor/search-executor.js'
import {createMockRuntimeSignalStore} from '../../../helpers/mock-factories.js'

function makeSearchResult(count: number): SearchKnowledgeResult {
  return {
    message: `Found ${count} results`,
    results: Array.from({length: count}, (_, i) => ({
      excerpt: `Excerpt for result ${i + 1}`,
      path: `domain/topic-${i + 1}.md`,
      score: 0.9 - i * 0.1,
      title: `Topic ${i + 1}`,
    })),
    totalFound: count,
  }
}

function makeMockService(result: SearchKnowledgeResult): ISearchKnowledgeService {
  return {
    search: sinon.stub().resolves(result),
  }
}

describe('SearchExecutor', () => {
  it('passes query to search service and returns results', async () => {
    const result = makeSearchResult(3)
    const service = makeMockService(result)
    const executor = new SearchExecutor(service)

    const actual = await executor.execute({query: 'authentication'})

    expect((service.search as sinon.SinonStub).calledWith('authentication', {limit: 10})).to.be.true
    expect(actual).to.equal(result)
    expect(actual.results).to.have.length(3)
    expect(actual.totalFound).to.equal(3)
  })

  it('respects custom limit', async () => {
    const service = makeMockService(makeSearchResult(5))
    const executor = new SearchExecutor(service)

    await executor.execute({limit: 5, query: 'test'})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 5})).to.be.true
  })

  it('caps limit at 50', async () => {
    const service = makeMockService(makeSearchResult(0))
    const executor = new SearchExecutor(service)

    await executor.execute({limit: 100, query: 'test'})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 50})).to.be.true
  })

  it('floors limit at 1', async () => {
    const service = makeMockService(makeSearchResult(0))
    const executor = new SearchExecutor(service)

    await executor.execute({limit: 0, query: 'test'})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 1})).to.be.true
  })

  it('truncates fractional limit', async () => {
    const service = makeMockService(makeSearchResult(0))
    const executor = new SearchExecutor(service)

    await executor.execute({limit: 7.9, query: 'test'})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 7})).to.be.true
  })

  it('passes scope when provided', async () => {
    const service = makeMockService(makeSearchResult(1))
    const executor = new SearchExecutor(service)

    await executor.execute({query: 'test', scope: 'auth/'})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 10, scope: 'auth/'})).to.be.true
  })

  it('passes trailing-slash scope unchanged (normalization is service responsibility)', async () => {
    const service = makeMockService(makeSearchResult(1))
    const executor = new SearchExecutor(service)

    await executor.execute({query: 'test', scope: 'project/'})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 10, scope: 'project/'})).to.be.true
  })

  it('omits scope when not provided', async () => {
    const service = makeMockService(makeSearchResult(1))
    const executor = new SearchExecutor(service)

    await executor.execute({query: 'test'})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 10})).to.be.true
  })

  it('returns empty results for empty query without calling service', async () => {
    const service = makeMockService(makeSearchResult(1))
    const executor = new SearchExecutor(service)

    const actual = await executor.execute({query: ''})

    expect(actual.results).to.have.length(0)
    expect(actual.totalFound).to.equal(0)
    expect((service.search as sinon.SinonStub).called).to.be.false
  })

  it('returns empty results for whitespace-only query', async () => {
    const service = makeMockService(makeSearchResult(1))
    const executor = new SearchExecutor(service)

    const actual = await executor.execute({query: '   '})

    expect(actual.results).to.have.length(0)
    expect((service.search as sinon.SinonStub).called).to.be.false
  })

  it('trims whitespace-only scope to undefined', async () => {
    const service = makeMockService(makeSearchResult(1))
    const executor = new SearchExecutor(service)

    await executor.execute({query: 'test', scope: '  '})

    expect((service.search as sinon.SinonStub).calledWith('test', {limit: 10})).to.be.true
  })

  it('returns empty results when service finds nothing', async () => {
    const emptyResult = makeSearchResult(0)
    const service = makeMockService(emptyResult)
    const executor = new SearchExecutor(service)

    const actual = await executor.execute({query: 'nonexistent topic'})

    expect(actual.results).to.have.length(0)
    expect(actual.totalFound).to.equal(0)
  })

  it('propagates service errors', async () => {
    const service: ISearchKnowledgeService = {
      search: sinon.stub().rejects(new Error('index corrupted')),
    }
    const executor = new SearchExecutor(service)

    try {
      await executor.execute({query: 'test'})
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).to.equal('index corrupted')
    }
  })

  it('bumps runtime-signal accessCount for each returned result path when store is provided', async () => {
    const result = makeSearchResult(3)
    const service = makeMockService(result)
    const store = createMockRuntimeSignalStore()
    const executor = new SearchExecutor(service, store)

    await executor.execute({query: 'authentication'})

    const a = await store.get('domain/topic-1.md')
    const b = await store.get('domain/topic-2.md')
    const c = await store.get('domain/topic-3.md')
    expect(a.accessCount).to.equal(1)
    expect(b.accessCount).to.equal(1)
    expect(c.accessCount).to.equal(1)
  })

  it('returns search results normally when no runtime-signal store is provided', async () => {
    const result = makeSearchResult(2)
    const service = makeMockService(result)
    const executor = new SearchExecutor(service)

    const actual = await executor.execute({query: 'foo'})
    expect(actual.results).to.have.length(2)
  })

  it('skips shared-origin results when bumping the sidecar (avoids orphans + collisions)', async () => {
    // SearchKnowledgeResult.results carry an `origin: 'local' | 'shared'`
    // when the project has registered knowledge sources. Shared paths are
    // relative to the SHARED tree's context-tree root, not this project's
    // sidecar — writing them here would either orphan an entry forever
    // (no matching local file) or collide on a same-named local topic and
    // corrupt its ranking signals.
    const mixed: SearchKnowledgeResult = {
      message: '',
      results: [
        {excerpt: '', origin: 'local', path: 'local/topic.md', score: 0.9, title: 'Local'},
        {excerpt: '', origin: 'shared', path: 'auth/jwt.md', score: 0.85, title: 'Shared'},
      ],
      totalFound: 2,
    }
    const service = makeMockService(mixed)
    const store = createMockRuntimeSignalStore()
    const executor = new SearchExecutor(service, store)

    await executor.execute({query: 'jwt'})

    const local = await store.get('local/topic.md')
    expect(local.accessCount).to.equal(1)

    // Shared path must not have been touched
    const signalsByPath = await store.list()
    expect(signalsByPath.has('auth/jwt.md')).to.equal(false)
  })

  it('omits the helper call entirely when ALL matches are shared-origin', async () => {
    const allShared: SearchKnowledgeResult = {
      message: '',
      results: [
        {excerpt: '', origin: 'shared', path: 'shared-a.md', score: 0.9, title: 'A'},
        {excerpt: '', origin: 'shared', path: 'shared-b.md', score: 0.85, title: 'B'},
      ],
      totalFound: 2,
    }
    const service = makeMockService(allShared)
    const store = createMockRuntimeSignalStore()
    const executor = new SearchExecutor(service, store)

    const actual = await executor.execute({query: 'q'})

    expect(actual.results).to.have.length(2) // still returns results
    const signalsByPath = await store.list()
    expect(signalsByPath.size).to.equal(0)
  })
})
