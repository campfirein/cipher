import {expect} from 'chai'

import type {IMemoryStoreService} from '../../../../src/agent/infra/nclm/memory-store-service.js'

import {createMemoryStoreService} from '../../../../src/agent/infra/nclm/memory-store-service.js'
import {MemoryStore} from '../../../../src/agent/infra/nclm/memory-store.js'

describe('MemoryStoreService', () => {
  let store: MemoryStore
  let service: IMemoryStoreService

  beforeEach(() => {
    store = new MemoryStore()
    service = createMemoryStoreService(store)
  })

  it('write delegates to memoryStore.write with correct params', () => {
    const entry = service.write('Test title', 'Test content', ['tag1'], 70)
    expect(entry.title).to.equal('Test title')
    expect(entry.content).to.equal('Test content')
    expect(entry.tags).to.deep.equal(['tag1'])
    expect(entry.importance).to.equal(70)

    // Verify it's in the store
    expect(store.read(entry.id)).to.not.be.null
  })

  it('write uses defaults for optional params', () => {
    const entry = service.write('Minimal', 'Content only')
    expect(entry.tags).to.deep.equal([])
    expect(entry.importance).to.equal(50)
  })

  it('update delegates to memoryStore.update with correct params', () => {
    const entry = service.write('Original', 'Original content')
    const updated = service.update(entry.id, {content: 'New content', title: 'New title'})
    expect(updated.title).to.equal('New title')
    expect(updated.content).to.equal('New content')
  })

  it('search delegates to memoryStore.search with correct params', () => {
    service.write('JWT token rotation', 'Refresh tokens rotate every 24 hours', ['auth'])
    const results = service.search('JWT token', 5, ['auth'])
    expect(results.length).to.be.greaterThan(0)
    expect(results[0].entry.title).to.equal('JWT token rotation')
  })

  it('search passes includeArchived to memoryStore', () => {
    const entry = service.write('Archived entry', 'Content here', ['auth'])
    service.archive(entry.id)

    // Without includeArchived — should not appear
    const excluded = service.search('archived entry', 5, undefined, false)
    expect(excluded.length).to.equal(0)

    // With includeArchived — should appear
    const included = service.search('archived entry', 5, undefined, true)
    expect(included.length).to.be.greaterThan(0)
  })

  it('read delegates to memoryStore.read', () => {
    const entry = service.write('Readable', 'Content')
    const result = service.read(entry.id)
    expect(result).to.not.be.null
    expect(result!.title).to.equal('Readable')
  })

  it('read returns null for non-existent id', () => {
    expect(service.read('nonexistent')).to.be.null
  })

  it('list delegates to memoryStore.list with ListParams', () => {
    service.write('First', 'aaa', ['auth'])
    service.write('Second', 'bbb', ['cache'])
    const entries = service.list({tags: ['auth']})
    expect(entries.length).to.equal(1)
    expect(entries[0].title).to.equal('First')
  })

  it('latest delegates to memoryStore.latest', () => {
    service.write('Old', 'aaa')
    service.write('New', 'bbb')
    const entry = service.latest()
    expect(entry).to.not.be.null
    expect(entry!.title).to.equal('New')
  })

  it('latest delegates tag filter', () => {
    service.write('Auth entry', 'aaa', ['auth'])
    service.write('Cache entry', 'bbb', ['cache'])
    expect(service.latest('auth')!.title).to.equal('Auth entry')
  })

  it('free delegates to memoryStore.free', () => {
    const entry = service.write('To free', 'Content')
    service.free(entry.id)
    expect(store.read(entry.id)).to.be.null
  })

  it('archive delegates to memoryStore.archive', () => {
    const entry = service.write('To archive', 'Content')
    service.archive(entry.id)
    expect(entry.status).to.equal('archived')
    expect(entry.stub).to.be.a('string')
  })

  it('compact delegates to memoryStore.compact', () => {
    for (let i = 0; i < 5; i++) {
      service.write(`Note ${i}`, `Detail ${i}`, ['auth'], 20 + i * 10)
    }

    const result = service.compact('auth')
    expect(result.summaryEntry).to.exist
    expect(result.archivedIds.length).to.be.greaterThan(0)
  })

  it('stats delegates to memoryStore.stats', () => {
    service.write('Entry 1', 'aaa')
    service.write('Entry 2', 'bbb')
    const stats = service.stats()
    expect(stats.active_count).to.equal(2)
    expect(stats.total_count).to.equal(2)
  })
})
