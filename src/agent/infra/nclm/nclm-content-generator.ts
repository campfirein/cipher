import type {GenerateContentChunk, GenerateContentRequest, GenerateContentResponse, IContentGenerator} from '../../core/interfaces/i-content-generator.js'
import type {MemoryStats} from './memory-types.js'
import type {NCLMCoreConfig} from './nclm-core-types.js'

import {MemoryStore} from './memory-store.js'
import {NCLMCore} from './nclm-core.js'

/**
 * NCLMContentGenerator — IContentGenerator wrapper for SDK users.
 *
 * Wraps an inner LLM with NCLM's memory-augmented iteration loop.
 * SDK users create this once, and every generateContent() call runs
 * NCLMCore.completion() with the shared MemoryStore.
 *
 * Usage:
 *   const nclm = new NCLMContentGenerator({ innerGenerator: myLLM, memoryStore: new MemoryStore() })
 *   const response = await nclm.generateContent(request)
 */
export class NCLMContentGenerator implements IContentGenerator {
  private readonly config: NCLMCoreConfig
  private readonly innerGenerator: IContentGenerator
  private memoryStore: MemoryStore

  constructor(params: {
    config?: Partial<NCLMCoreConfig>
    innerGenerator: IContentGenerator
    memoryStore: MemoryStore
  }) {
    this.innerGenerator = params.innerGenerator
    this.memoryStore = params.memoryStore
    this.config = {
      maxDepth: 2,
      maxErrors: 3,
      maxIterations: 10,
      persistent: true,
      ...params.config,
    }
  }

  estimateTokensSync(content: string): number {
    return this.innerGenerator.estimateTokensSync(content)
  }

  async generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse> {
    // Extract user message from the request
    const userMessage = this.extractUserMessage(request)

    // Run the full NCLM iteration loop
    const core = new NCLMCore(this.innerGenerator, this.memoryStore, this.config)
    const completion = await core.completion(userMessage)

    return {
      content: completion.response,
      finishReason: 'stop',
      usage: {
        completionTokens: completion.usage.outputTokens,
        promptTokens: completion.usage.inputTokens,
        totalTokens: completion.usage.inputTokens + completion.usage.outputTokens,
      },
    }
  }

  async *generateContentStream(request: GenerateContentRequest): AsyncGenerator<GenerateContentChunk> {
    // Run completion (non-streaming internally), then yield the result as chunks
    const response = await this.generateContent(request)

    yield {
      content: response.content,
      finishReason: response.finishReason,
      isComplete: true,
    }
  }

  /** Get current memory statistics */
  getMemoryStats(): MemoryStats {
    return this.memoryStore.stats()
  }

  /** Get the shared MemoryStore instance */
  getMemoryStore(): MemoryStore {
    return this.memoryStore
  }

  /** Reset memory — creates a fresh MemoryStore */
  resetMemory(): void {
    this.memoryStore = new MemoryStore()
  }

  private extractUserMessage(request: GenerateContentRequest): string {
    const contents = request.contents ?? []
    const lastUser = [...contents].reverse().find((m) => m.role === 'user')
    if (!lastUser) {
      return ''
    }

    return typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content)
  }
}
