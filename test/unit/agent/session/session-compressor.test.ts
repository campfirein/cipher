import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {Memory} from '../../../../src/agent/core/domain/memory/types.js'
import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'
import type {InternalMessage} from '../../../../src/agent/core/interfaces/message-types.js'
import type {MemoryDeduplicator} from '../../../../src/agent/infra/memory/memory-deduplicator.js'
import type {MemoryManager} from '../../../../src/agent/infra/memory/memory-manager.js'

import {SessionCompressor} from '../../../../src/agent/infra/session/session-compressor.js'

describe('SessionCompressor', () => {
  const messages: InternalMessage[] = [
    {
      content: 'Analyze auth module from src/auth/jwt.ts and src/auth/session.ts',
      role: 'user',
    },
    {
      content: 'Applied knowledge to architecture/authentication/auth_module_overview.md',
      role: 'assistant',
    },
  ]

  afterEach(() => {
    restore()
  })

  it('creates fallback curate memories when extraction returns no JSON drafts', async () => {
    const deduplicateStub = stub().resolves([])
    const deduplicator = {
      deduplicate: deduplicateStub,
    } as unknown as MemoryDeduplicator
    const generator = {
      estimateTokensSync: () => 0,
      generateContent: stub().resolves({content: '', finishReason: 'stop'}),
      async *generateContentStream() {
        yield {deltaText: 'not-json'}
        yield {isComplete: true}
      },
    } as unknown as IContentGenerator
    const created: Memory[] = []
    const memoryManager = {
      create: stub().callsFake(async (input: {content: string; metadata?: {category?: string}; tags?: string[]}) => {
        const memory = {
          content: input.content,
          createdAt: Date.now(),
          id: `memory-${created.length + 1}`,
          metadata: input.metadata,
          tags: input.tags,
          updatedAt: Date.now(),
        } as Memory
        created.push(memory)
        return memory
      }),
      list: stub().resolves([]),
      update: stub().resolves(),
    } as unknown as MemoryManager

    const compressor = new SessionCompressor(deduplicator, generator, memoryManager)
    const result = await compressor.compress(messages, 'curate', {minMessages: 2})

    expect(result).to.deep.equal({created: 6, merged: 0, skipped: 0})
    expect(created.map((memory) => memory.metadata?.category)).to.deep.equal([
      'DECISIONS',
      'DECISIONS',
      'PATTERNS',
      'PATTERNS',
      'SKILLS',
      'ENTITIES',
    ])
    expect(deduplicateStub.called).to.equal(false)
  })

  it('skips fallback entity duplicates while creating the other curate memories', async () => {
    const existingEntity = {
      content: 'src/auth is an actively curated module surfaced during curate.',
      createdAt: Date.now(),
      id: 'existing-entity',
      metadata: {category: 'ENTITIES', source: 'agent'},
      updatedAt: Date.now(),
    } as Memory
    const deduplicateStub = stub().resolves([])
    const deduplicator = {
      deduplicate: deduplicateStub,
    } as unknown as MemoryDeduplicator
    const generator = {
      estimateTokensSync: () => 0,
      generateContent: stub().resolves({content: '', finishReason: 'stop'}),
      async *generateContentStream() {
        yield {deltaText: 'not-json'}
        yield {isComplete: true}
      },
    } as unknown as IContentGenerator
    const memoryManager = {
      create: stub().resolves(),
      list: stub().resolves([existingEntity]),
      update: stub().resolves(),
    } as unknown as MemoryManager

    const compressor = new SessionCompressor(deduplicator, generator, memoryManager)
    const result = await compressor.compress(messages, 'curate', {minMessages: 2})

    expect(result).to.deep.equal({created: 5, merged: 0, skipped: 1})
    expect((memoryManager.create as unknown as ReturnType<typeof stub>).callCount).to.equal(5)
    expect(deduplicateStub.called).to.equal(false)
  })

  it('compresses a short curate session when assistant output exists', async () => {
    const deduplicateStub = stub().resolves([])
    const deduplicator = {
      deduplicate: deduplicateStub,
    } as unknown as MemoryDeduplicator
    const generator = {
      estimateTokensSync: () => 0,
      generateContent: stub().resolves({content: '', finishReason: 'stop'}),
      async *generateContentStream() {
        yield {deltaText: 'not-json'}
        yield {isComplete: true}
      },
    } as unknown as IContentGenerator
    const memoryManager = {
      create: stub().resolves(),
      list: stub().resolves([]),
      update: stub().resolves(),
    } as unknown as MemoryManager

    const compressor = new SessionCompressor(deduplicator, generator, memoryManager)
    const shortMessages: InternalMessage[] = [{
      content: 'Applied knowledge from src/auth/jwt.ts and src/auth/session.ts to security/authentication/token_issuance.md',
      role: 'assistant',
    }]
    const result = await compressor.compress(shortMessages, 'curate', {minMessages: 2})

    expect(result).to.deep.equal({created: 6, merged: 0, skipped: 0})
    expect((memoryManager.create as unknown as ReturnType<typeof stub>).callCount).to.equal(6)
  })

  it('prefers deterministic fallback drafts for short curate sessions even when the extractor returns JSON', async () => {
    const deduplicateStub = stub().resolves([])
    const deduplicator = {
      deduplicate: deduplicateStub,
    } as unknown as MemoryDeduplicator
    const generator = {
      estimateTokensSync: () => 0,
      generateContent: stub().resolves({content: '', finishReason: 'stop'}),
      async *generateContentStream() {
        yield {deltaText: JSON.stringify([{category: 'PREFERENCES', content: 'Prefer overview docs'}])}
        yield {isComplete: true}
      },
    } as unknown as IContentGenerator
    const created: Memory[] = []
    const memoryManager = {
      create: stub().callsFake(async (input: {content: string; metadata?: {category?: string}; tags?: string[]}) => {
        const memory = {
          content: input.content,
          createdAt: Date.now(),
          id: `memory-${created.length + 1}`,
          metadata: input.metadata,
          tags: input.tags,
          updatedAt: Date.now(),
        } as Memory
        created.push(memory)
        return memory
      }),
      list: stub().resolves([]),
      update: stub().resolves(),
    } as unknown as MemoryManager

    const compressor = new SessionCompressor(deduplicator, generator, memoryManager)
    const result = await compressor.compress(messages, 'curate', {minMessages: 2})

    expect(result).to.deep.equal({created: 6, merged: 0, skipped: 0})
    expect(created.map((memory) => memory.metadata?.category)).to.deep.equal([
      'DECISIONS',
      'DECISIONS',
      'PATTERNS',
      'PATTERNS',
      'SKILLS',
      'ENTITIES',
    ])
    expect(deduplicateStub.called).to.equal(false)
  })

  it('parses LLM-extracted drafts wrapped in ```json code fences (query path)', async () => {
    const fencedJson = '```json\n[{"category":"ENTITIES","content":"auth module","tags":["auth"]}]\n```'
    const deduplicateStub = stub().callsFake(async (drafts: Array<{category: string; content: string}>) =>
      drafts.map((memory) => ({action: 'CREATE' as const, memory})),
    )
    const deduplicator = {
      deduplicate: deduplicateStub,
    } as unknown as MemoryDeduplicator
    const generator = {
      estimateTokensSync: () => 0,
      generateContent: stub().resolves({content: '', finishReason: 'stop'}),
      async *generateContentStream() {
        yield {content: fencedJson}
      },
    } as unknown as IContentGenerator
    const created: Memory[] = []
    const memoryManager = {
      create: stub().callsFake(async (input: {content: string; metadata?: {category?: string}; tags?: string[]}) => {
        const memory = {
          content: input.content,
          createdAt: Date.now(),
          id: `memory-${created.length + 1}`,
          metadata: input.metadata,
          tags: input.tags,
          updatedAt: Date.now(),
        } as Memory
        created.push(memory)
        return memory
      }),
      list: stub().resolves([]),
      update: stub().resolves(),
    } as unknown as MemoryManager

    const queryMessages: InternalMessage[] = [
      {content: 'How does JWT auth work?', role: 'user'},
      {content: 'JWT uses access and refresh tokens...', role: 'assistant'},
      {content: 'What about session rotation?', role: 'user'},
      {content: 'Session rotation appends :rotated suffix...', role: 'assistant'},
    ]
    const compressor = new SessionCompressor(deduplicator, generator, memoryManager)
    const result = await compressor.compress(queryMessages, 'query', {minMessages: 2})

    expect(result.created).to.equal(1)
    expect(created).to.have.length(1)
    expect(created[0].content).to.equal('auth module')
    expect(created[0].metadata?.category).to.equal('ENTITIES')
    expect(deduplicateStub.calledOnce).to.equal(true)
  })

  it('keeps user-only short curate sessions below the compression threshold', async () => {
    const deduplicateStub = stub().resolves([])
    const deduplicator = {
      deduplicate: deduplicateStub,
    } as unknown as MemoryDeduplicator
    const generator = {
      estimateTokensSync: () => 0,
      generateContent: stub().resolves({content: '', finishReason: 'stop'}),
      async *generateContentStream() {
        yield {deltaText: 'not-json'}
        yield {isComplete: true}
      },
    } as unknown as IContentGenerator
    const memoryManager = {
      create: stub().resolves(),
      list: stub().resolves([]),
      update: stub().resolves(),
    } as unknown as MemoryManager

    const compressor = new SessionCompressor(deduplicator, generator, memoryManager)
    const result = await compressor.compress([{
      content: 'Analyze auth module from src/auth/jwt.ts and src/auth/session.ts',
      role: 'user',
    }], 'curate', {minMessages: 2})

    expect(result).to.deep.equal({created: 0, merged: 0, skipped: 0})
    expect((memoryManager.create as unknown as ReturnType<typeof stub>).called).to.equal(false)
  })
})
