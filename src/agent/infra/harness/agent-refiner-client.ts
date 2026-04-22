/**
 * AutoHarness V2 — Agent-scoped refiner client.
 *
 * Implements `IRefinerClient` by wrapping an `IContentGenerator` directly,
 * bypassing `ILLMService`. This avoids creating a full agentic LLM service
 * (with tool calling, context management, etc.) when all the synthesizer
 * needs is simple prompt → text completions for the Critic and Refiner.
 *
 * Created once at agent init time in `service-initializer.ts`.
 */

import {randomUUID} from 'node:crypto'

import type {
  GenerateContentRequest,
  IContentGenerator,
} from '../../core/interfaces/i-content-generator.js'
import type {IRefinerClient} from './harness-refiner-client.js'

export class AgentRefinerClient implements IRefinerClient {
  constructor(
    private readonly generator: IContentGenerator,
    public readonly modelId: string,
  ) {}

  async completeCritic(prompt: string): Promise<string> {
    return this.complete(prompt)
  }

  async completeRefiner(prompt: string): Promise<string> {
    return this.complete(prompt)
  }

  private async complete(prompt: string): Promise<string> {
    const request: GenerateContentRequest = {
      config: {maxTokens: 4096, temperature: 0},
      contents: [{content: prompt, role: 'user'}],
      model: this.modelId,
      taskId: randomUUID(),
    }
    const response = await this.generator.generateContent(request)
    return response.content
  }
}
