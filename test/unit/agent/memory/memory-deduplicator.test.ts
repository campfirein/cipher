import {expect} from 'chai'
import {createSandbox} from 'sinon'

import type {Memory} from '../../../../src/agent/core/domain/memory/types.js'
import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'

import {MemoryDeduplicator} from '../../../../src/agent/infra/memory/memory-deduplicator.js'

describe('MemoryDeduplicator', () => {
  const sandbox = createSandbox()

  afterEach(() => {
    sandbox.restore()
  })

  it('includes all fetched existing memories in the dedup prompt', async () => {
    let capturedPrompt = ''
    const generator = {
      estimateTokensSync: () => 10,
      generateContent: sandbox.stub().callsFake(async ({contents}: {contents: Array<{content: string}>}) => {
        capturedPrompt = contents[0].content
        return {content: '{"action":"SKIP"}', finishReason: 'stop'}
      }),
      generateContentStream: sandbox.stub().rejects(new Error('n/a')),
    } as unknown as IContentGenerator

    const deduplicator = new MemoryDeduplicator(generator)
    const existing = Array.from({length: 25}, (_, index) => ({
      content: `Existing memory ${index + 1}`,
      createdAt: 0,
      id: `m${index + 1}`,
      updatedAt: 0,
    })) satisfies Memory[]

    await deduplicator.deduplicate([{category: 'PATTERNS', content: 'New draft'}], existing)

    expect(capturedPrompt).to.include('[id:m25] Existing memory 25')
  })

  it('rejects MERGE decisions that target a missing memory id', async () => {
    const generator = {
      estimateTokensSync: () => 10,
      generateContent: sandbox.stub().resolves({
        content: '{"action":"MERGE","targetId":"missing","mergedContent":"Merged"}',
        finishReason: 'stop',
      }),
      generateContentStream: sandbox.stub().rejects(new Error('n/a')),
    } as unknown as IContentGenerator

    const deduplicator = new MemoryDeduplicator(generator)
    const existing = [{
      content: 'Existing memory',
      createdAt: 0,
      id: 'm1',
      updatedAt: 0,
    }] satisfies Memory[]

    const [action] = await deduplicator.deduplicate([{category: 'PATTERNS', content: 'New draft'}], existing)
    expect(action.action).to.equal('CREATE')
  })

  it('processes each draft exactly once across concurrent workers', async () => {
    const seenDrafts: string[] = []
    const generator = {
      estimateTokensSync: () => 10,
      generateContent: sandbox.stub().callsFake(async ({contents}: {contents: Array<{content: string}>}) => {
        const prompt = contents[0].content
        const match = /## Draft Memory \(category: [^)]+\)\n([\s\S]*?)\n\n## Existing Memories/.exec(prompt)
        seenDrafts.push(match?.[1] ?? '')
        return {content: '{"action":"SKIP"}', finishReason: 'stop'}
      }),
      generateContentStream: sandbox.stub().rejects(new Error('n/a')),
    } as unknown as IContentGenerator

    const deduplicator = new MemoryDeduplicator(generator)
    const existing = [{
      content: 'Existing memory',
      createdAt: 0,
      id: 'm1',
      updatedAt: 0,
    }] satisfies Memory[]
    const drafts = Array.from({length: 8}, (_, index) => ({
      category: 'PATTERNS' as const,
      content: `Draft ${index + 1}`,
    }))

    const actions = await deduplicator.deduplicate(drafts, existing)

    expect(actions).to.have.length(8)
    expect(seenDrafts.sort()).to.deep.equal(drafts.map((draft) => draft.content).sort())
  })
})
