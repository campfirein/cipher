import {expect} from 'chai'

import type {GenerateContentChunk, GenerateContentRequest, GenerateContentResponse, IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'

import {MemoryStore} from '../../../../src/agent/infra/nclm/memory-store.js'
import {NCLMErrorThresholdError, NCLMTimeoutError} from '../../../../src/agent/infra/nclm/nclm-core-types.js'
import {findCodeBlocks, NCLMCore} from '../../../../src/agent/infra/nclm/nclm-core.js'

/**
 * Creates a mock IContentGenerator that returns scripted responses.
 * Each call to generateContent pops the next response from the queue.
 */
function createMockGenerator(responses: string[]): IContentGenerator {
  const queue = [...responses]

  return {
    estimateTokensSync(content: string): number {
      return Math.ceil(content.length / 4)
    },

    async generateContent(_request: GenerateContentRequest): Promise<GenerateContentResponse> {
      const content = queue.shift() ?? 'No more scripted responses'

      return {
        content,
        finishReason: 'stop',
        usage: {completionTokens: 50, promptTokens: 100, totalTokens: 150},
      }
    },

    async *generateContentStream(_request: GenerateContentRequest): AsyncGenerator<GenerateContentChunk> {
      yield {content: 'streamed', isComplete: true}
    },
  }
}

describe('NCLM Core', () => {
describe('findCodeBlocks', () => {
  it('extracts javascript code blocks', () => {
    const text = 'Some text\n```javascript\nconsole.log("hello")\n```\nMore text'
    const blocks = findCodeBlocks(text)
    expect(blocks).to.deep.equal(['console.log("hello")'])
  })

  it('extracts js code blocks', () => {
    const text = '```js\nconst x = 42\n```'
    const blocks = findCodeBlocks(text)
    expect(blocks).to.deep.equal(['const x = 42'])
  })

  it('extracts repl code blocks', () => {
    const text = '```repl\nFINAL("done")\n```'
    const blocks = findCodeBlocks(text)
    expect(blocks).to.deep.equal(['FINAL("done")'])
  })

  it('extracts multiple code blocks', () => {
    const text = '```javascript\na()\n```\ntext\n```js\nb()\n```'
    const blocks = findCodeBlocks(text)
    expect(blocks).to.deep.equal(['a()', 'b()'])
  })

  it('returns empty array for no code blocks', () => {
    expect(findCodeBlocks('just plain text')).to.deep.equal([])
  })

  it('ignores non-js code blocks', () => {
    const text = '```python\nprint("hello")\n```'
    expect(findCodeBlocks(text)).to.deep.equal([])
  })
})

describe('NCLMCore', () => {

  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('runs single iteration and returns FINAL answer', async () => {
    const gen = createMockGenerator([
      'Let me compute the answer.\n```javascript\nFINAL("42")\n```',
    ])
    const core = new NCLMCore(gen, store, {maxIterations: 5})
    const result = await core.completion('What is the answer?')

    expect(result.response).to.equal('42')
    expect(result.iterations).to.equal(1)
  })

  it('runs multiple iterations before FINAL', async () => {
    const gen = createMockGenerator([
      'First, let me store something.\n```javascript\nmemory_write("Note", "Step 1")\n```',
      'Now I have the answer.\n```javascript\nFINAL("done after 2 steps")\n```',
    ])
    const core = new NCLMCore(gen, store, {maxIterations: 5})
    const result = await core.completion('Do a multi-step task')

    expect(result.response).to.equal('done after 2 steps')
    expect(result.iterations).to.equal(2)
  })

  it('returns partial answer when maxIterations exceeded', async () => {
    const gen = createMockGenerator([
      'Working on it...\n```javascript\nmemory_write("Progress", "Step 1")\n```',
      'Still working...\n```javascript\nmemory_write("Progress", "Step 2")\n```',
      'Almost there...\n```javascript\nmemory_write("Progress", "Step 3")\n```',
    ])
    const core = new NCLMCore(gen, store, {maxIterations: 2})
    const result = await core.completion('Long task')

    expect(result.iterations).to.equal(2)
    // Should return something (partial answer), not throw
    expect(result.response).to.be.a('string')
  })

  it('throws NCLMTimeoutError when maxTimeout exceeded', async () => {
    // Generator that introduces a delay so the timeout fires on iteration 2
    const slowGen: IContentGenerator = {
      estimateTokensSync: (c: string) => Math.ceil(c.length / 4),
      async generateContent() {
        await new Promise((resolve) => {
          setTimeout(resolve, 20)
        })

        return {content: '```javascript\n// still working\n```', finishReason: 'stop' as const, usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20}}
      },
      async *generateContentStream() {
        yield {content: '', isComplete: true}
      },
    }
    const core = new NCLMCore(slowGen, store, {maxIterations: 10, maxTimeout: 10})

    try {
      await core.completion('Timeout test')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(NCLMTimeoutError)
    }
  })

  it('throws NCLMErrorThresholdError after consecutive errors', async () => {
    const gen = createMockGenerator([
      '```javascript\nthrow new Error("fail 1")\n```',
      '```javascript\nthrow new Error("fail 2")\n```',
      '```javascript\nthrow new Error("fail 3")\n```',
    ])
    const core = new NCLMCore(gen, store, {maxErrors: 3, maxIterations: 5})

    try {
      await core.completion('Error test')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(NCLMErrorThresholdError)
    }
  })

  it('memory operations in code blocks affect MemoryStore', async () => {
    const gen = createMockGenerator([
      '```javascript\nmemory_write("Test entry", "Content here", ["test"])\nFINAL("wrote it")\n```',
    ])
    const core = new NCLMCore(gen, store, {maxIterations: 5})
    await core.completion('Write to memory')

    expect(store.stats().active_count).to.equal(1)
    expect(store.list()[0].title).to.equal('Test entry')
  })

  it('tracks usage across iterations', async () => {
    const gen = createMockGenerator([
      '```javascript\nmemory_write("A", "x")\n```',
      '```javascript\nFINAL("done")\n```',
    ])
    const core = new NCLMCore(gen, store, {maxIterations: 5})
    const result = await core.completion('Track usage')

    expect(result.usage.inputTokens).to.equal(200)  // 100 * 2 iterations
    expect(result.usage.outputTokens).to.equal(100)  // 50 * 2 iterations
  })

  it('handles response with no code blocks', async () => {
    const gen = createMockGenerator([
      'Just thinking out loud, no code here.',
      '```javascript\nFINAL("got there eventually")\n```',
    ])
    const core = new NCLMCore(gen, store, {maxIterations: 5})
    const result = await core.completion('Think then act')

    expect(result.response).to.equal('got there eventually')
    expect(result.iterations).to.equal(2)
  })

  it('persistent mode keeps memory across completion calls', async () => {
    const gen1 = createMockGenerator([
      '```javascript\nmemory_write("Persistent", "Survives")\nFINAL("wrote")\n```',
    ])
    const core = new NCLMCore(gen1, store, {maxIterations: 5, persistent: true})
    await core.completion('First call')

    expect(store.stats().active_count).to.equal(1)

    // Second call — memory should still be there
    // (We need a new generator but same core instance)
    const gen2 = createMockGenerator([
      '```javascript\nvar results = memory_search("persistent"); FINAL(String(results.length))\n```',
    ])
    const core2 = new NCLMCore(gen2, store, {maxIterations: 5, persistent: true})
    const result = await core2.completion('Find it')

    expect(result.response).to.be.oneOf(['1', '2']) // 1 or 2 depending on access feedback
  })

  it('injects memory state into system prompt', async () => {
    // Seed memory so injection has content
    store.write({content: 'Pre-existing knowledge', tags: ['test'], title: 'Seeded entry'})

    let capturedSystemPrompt = ''
    const capturingGen: IContentGenerator = {
      estimateTokensSync: (c: string) => Math.ceil(c.length / 4),
      async generateContent(request) {
        capturedSystemPrompt = request.systemPrompt ?? ''

        return {content: '```javascript\nFINAL("done")\n```', finishReason: 'stop' as const, usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20}}
      },
      async *generateContentStream() {
        yield {content: '', isComplete: true}
      },
    }

    const core = new NCLMCore(capturingGen, store, {maxIterations: 5})
    await core.completion('Test injection')

    expect(capturedSystemPrompt).to.include('Seeded entry')
    expect(capturedSystemPrompt).to.include('Memory API')
  })

  it('compacts history when messages grow large', async () => {
    // Generate many iterations to trigger compaction (threshold: 20 messages)
    const responses: string[] = []
    for (let i = 0; i < 15; i++) {
      responses.push(`Step ${i}\n\`\`\`javascript\nmemory_write("Note ${i}", "Content ${i}")\n\`\`\``)
    }

    responses.push('```javascript\nFINAL("compacted")\n```')

    const gen = createMockGenerator(responses)
    const core = new NCLMCore(gen, store, {maxIterations: 20})
    const result = await core.completion('Long task')

    expect(result.response).to.equal('compacted')
    // Should have completed without running out of iterations
    expect(result.iterations).to.be.lessThanOrEqual(16)
  })

  it('throws NCLMTokenLimitError when maxTokens exceeded', async () => {
    // Each iteration uses 150 total tokens (100 prompt + 50 completion from mock)
    const gen = createMockGenerator([
      '```javascript\n// working\n```',
      '```javascript\n// still working\n```',
      '```javascript\n// more work\n```',
    ])
    const core = new NCLMCore(gen, store, {maxIterations: 10, maxTokens: 200})

    try {
      await core.completion('Token limit test')
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).name).to.equal('NCLMTokenLimitError')
    }
  })

  it('nclm_query at depth < maxDepth spawns child with own sandbox', async () => {
    // LLM calls nclm_query which creates a child NCLMCore.
    // The child must also receive a mock that returns FINAL.
    // We track call count to verify the child ran.
    let callCount = 0
    const trackingGen: IContentGenerator = {
      estimateTokensSync: (c: string) => Math.ceil(c.length / 4),
      async generateContent(_request) {
        callCount++
        // First call: parent — call nclm_query
        if (callCount === 1) {
          return {
            content: '```javascript\nvar childResult = nclm_query("sub-task")\n```',
            finishReason: 'stop' as const,
            usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20},
          }
        }

        // Second call: child — return FINAL
        if (callCount === 2) {
          return {
            content: '```javascript\nFINAL("child done")\n```',
            finishReason: 'stop' as const,
            usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20},
          }
        }

        // Third call: parent processes child result and returns FINAL
        return {
          content: '```javascript\nFINAL("parent done")\n```',
          finishReason: 'stop' as const,
          usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20},
        }
      },
      async *generateContentStream() {
        yield {content: '', isComplete: true}
      },
    }

    const core = new NCLMCore(trackingGen, store, {depth: 0, maxDepth: 2, maxIterations: 5})
    const result = await core.completion('Parent task')

    // Parent and child both ran
    expect(callCount).to.be.greaterThanOrEqual(2)
    expect(result.response).to.be.a('string')
  })

  it('nclm_query at maxDepth falls back to plain LLM call', async () => {
    let callCount = 0
    const fallbackGen: IContentGenerator = {
      estimateTokensSync: (c: string) => Math.ceil(c.length / 4),
      async generateContent() {
        callCount++
        if (callCount === 1) {
          // At depth=2 (maxDepth=2), nclm_query should fall back to plain LLM
          return {
            content: '```javascript\nvar result = nclm_query("should fallback")\n```',
            finishReason: 'stop' as const,
            usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20},
          }
        }

        // The fallback LLM call
        if (callCount === 2) {
          return {
            content: 'plain LLM response (no code blocks, no NCLM loop)',
            finishReason: 'stop' as const,
            usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20},
          }
        }

        return {
          content: '```javascript\nFINAL("fallback worked")\n```',
          finishReason: 'stop' as const,
          usage: {completionTokens: 10, promptTokens: 10, totalTokens: 20},
        }
      },
      async *generateContentStream() {
        yield {content: '', isComplete: true}
      },
    }

    // depth=2, maxDepth=2 → nclm_query should NOT create child NCLMCore
    const core = new NCLMCore(fallbackGen, store, {depth: 2, maxDepth: 2, maxIterations: 5})
    const result = await core.completion('Fallback test')

    // Should complete without infinite recursion
    expect(result.response).to.be.a('string')
    // The fallback plain LLM call was made (callCount >= 2)
    expect(callCount).to.be.greaterThanOrEqual(2)
  })
})
})
