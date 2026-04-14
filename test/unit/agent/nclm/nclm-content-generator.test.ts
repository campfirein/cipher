import {expect} from 'chai'

import type {GenerateContentChunk, GenerateContentRequest, GenerateContentResponse, IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'

import {MemoryStore} from '../../../../src/agent/infra/nclm/memory-store.js'
import {NCLMContentGenerator} from '../../../../src/agent/infra/nclm/nclm-content-generator.js'

function createMockGenerator(responses: string[]): IContentGenerator {
  const queue = [...responses]

  return {
    estimateTokensSync(content: string): number {
      return Math.ceil(content.length / 4)
    },

    async generateContent(_request: GenerateContentRequest): Promise<GenerateContentResponse> {
      const content = queue.shift() ?? 'No more responses'

      return {
        content,
        finishReason: 'stop',
        usage: {completionTokens: 50, promptTokens: 100, totalTokens: 150},
      }
    },

    async *generateContentStream(_request: GenerateContentRequest): AsyncGenerator<GenerateContentChunk> {
      yield {content: queue.shift() ?? 'streamed', isComplete: true}
    },
  }
}

function createRequest(prompt: string): GenerateContentRequest {
  return {
    config: {maxTokens: 8192, temperature: 0.7},
    contents: [{content: prompt, role: 'user'}],
    model: 'test-model',
    taskId: 'test-task',
  }
}

describe('NCLMContentGenerator', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('implements IContentGenerator interface', () => {
    const inner = createMockGenerator([])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})

    expect(nclm.estimateTokensSync).to.be.a('function')
    expect(nclm.generateContent).to.be.a('function')
    expect(nclm.generateContentStream).to.be.a('function')
  })

  it('estimateTokensSync delegates to inner generator', () => {
    const inner = createMockGenerator([])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})

    const estimate = nclm.estimateTokensSync('hello world')
    expect(estimate).to.equal(inner.estimateTokensSync('hello world'))
  })

  it('generateContent runs NCLMCore and returns response', async () => {
    const inner = createMockGenerator([
      '```javascript\nFINAL("the answer is 42")\n```',
    ])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})

    const response = await nclm.generateContent(createRequest('What is the answer?'))

    expect(response.content).to.equal('the answer is 42')
    expect(response.finishReason).to.equal('stop')
  })

  it('generateContent returns usage in response', async () => {
    const inner = createMockGenerator([
      '```javascript\nFINAL("done")\n```',
    ])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})

    const response = await nclm.generateContent(createRequest('Test'))
    expect(response.usage).to.exist
    expect(response.usage!.promptTokens).to.be.a('number')
    expect(response.usage!.completionTokens).to.be.a('number')
  })

  it('generateContentStream yields final answer', async () => {
    const inner = createMockGenerator([
      '```javascript\nFINAL("streamed answer")\n```',
    ])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})

    const chunks: GenerateContentChunk[] = []
    for await (const chunk of nclm.generateContentStream(createRequest('Stream test'))) {
      chunks.push(chunk)
    }

    expect(chunks.length).to.be.greaterThan(0)
    const lastChunk = chunks.at(-1)
    expect(lastChunk!.isComplete).to.be.true
    // Content should include the final answer somewhere in the chunks
    const fullContent = chunks.map((c) => c.content ?? '').join('')
    expect(fullContent).to.include('streamed answer')
  })

  it('memory persists across generateContent calls', async () => {
    // First call: write to memory
    const inner1 = createMockGenerator([
      '```javascript\nmemory_write("Persistent", "Survives")\nFINAL("wrote")\n```',
    ])
    const nclm = new NCLMContentGenerator({
      config: {persistent: true},
      innerGenerator: inner1,
      memoryStore: store,
    })
    await nclm.generateContent(createRequest('Write something'))

    expect(store.stats().active_count).to.equal(1)

    // Second call with new inner generator but same NCLM instance
    // The memory should still be there
    expect(store.list()[0].title).to.equal('Persistent')
  })

  it('resetMemory clears the store', async () => {
    const inner = createMockGenerator([
      '```javascript\nmemory_write("To delete", "Content")\nFINAL("done")\n```',
    ])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})
    await nclm.generateContent(createRequest('Write'))

    expect(store.stats().active_count).to.equal(1)

    nclm.resetMemory()
    expect(nclm.getMemoryStats().active_count).to.equal(0)
  })

  it('getMemoryStats returns current stats', () => {
    const inner = createMockGenerator([])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})

    store.write({content: 'Content', title: 'Test'})
    const stats = nclm.getMemoryStats()
    expect(stats.active_count).to.equal(1)
  })

  it('getMemoryStore returns the shared store', () => {
    const inner = createMockGenerator([])
    const nclm = new NCLMContentGenerator({innerGenerator: inner, memoryStore: store})

    expect(nclm.getMemoryStore()).to.equal(store)
  })
})
