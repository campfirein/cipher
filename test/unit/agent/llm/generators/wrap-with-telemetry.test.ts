import {expect} from 'chai'

import type {AgentEventMap} from '../../../../../src/agent/core/domain/agent-events/types.js'
import type {GenerateContentChunk, GenerateContentRequest, GenerateContentResponse, IContentGenerator} from '../../../../../src/agent/core/interfaces/i-content-generator.js'

import {AgentEventBus} from '../../../../../src/agent/infra/events/event-emitter.js'
import {BACKGROUND_TELEMETRY_SESSION_ID, wrapBackgroundGeneratorWithTelemetry} from '../../../../../src/agent/infra/llm/generators/wrap-with-telemetry.js'

class FakeGenerator implements IContentGenerator {
  public estimateCalls = 0
  public response: GenerateContentResponse

  constructor(response: GenerateContentResponse) {
    this.response = response
  }

  estimateTokensSync(content: string): number {
    this.estimateCalls++
    return Math.ceil(content.length / 4)
  }

   
  async generateContent(_request: GenerateContentRequest): Promise<GenerateContentResponse> {
    return this.response
  }

  async *generateContentStream(_request: GenerateContentRequest): AsyncGenerator<GenerateContentChunk> {
    yield {content: this.response.content, finishReason: this.response.finishReason, isComplete: true, usage: this.response.usage}
  }
}

describe('wrapBackgroundGeneratorWithTelemetry', () => {
  it('forwards llmservice:usage events from the wrapped generator to the agent bus', async () => {
    const fake = new FakeGenerator({
      content: 'ok',
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
      },
    })
    const agentBus = new AgentEventBus()
    const seen: AgentEventMap['llmservice:usage'][] = []
    agentBus.on('llmservice:usage', (payload) => seen.push(payload))

    const wrapped = wrapBackgroundGeneratorWithTelemetry(fake, agentBus)
    await wrapped.generateContent({
      config: {temperature: 0},
      contents: [{content: 'hi', role: 'user'}],
      model: 'fake-model',
      taskId: 'task-abc',
    })

    expect(seen).to.have.lengthOf(1)
    expect(seen[0].inputTokens).to.equal(100)
    expect(seen[0].outputTokens).to.equal(25)
    expect(seen[0].totalTokens).to.equal(125)
    expect(seen[0].taskId).to.equal('task-abc')
    expect(seen[0].model).to.equal('fake-model')
    expect(seen[0].sessionId).to.equal(BACKGROUND_TELEMETRY_SESSION_ID)
  })

  it('honors a custom sessionId tag', async () => {
    const fake = new FakeGenerator({content: 'ok', finishReason: 'stop', usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2}})
    const agentBus = new AgentEventBus()
    const seen: AgentEventMap['llmservice:usage'][] = []
    agentBus.on('llmservice:usage', (payload) => seen.push(payload))

    const wrapped = wrapBackgroundGeneratorWithTelemetry(fake, agentBus, 'background:custom-tag')
    await wrapped.generateContent({config: {temperature: 0}, contents: [], model: 'm', taskId: 't'})

    expect(seen[0].sessionId).to.equal('background:custom-tag')
  })

  it('does not emit when the wrapped generator returns no usage', async () => {
    const fake = new FakeGenerator({content: 'ok', finishReason: 'stop'})
    const agentBus = new AgentEventBus()
    const seen: AgentEventMap['llmservice:usage'][] = []
    agentBus.on('llmservice:usage', (payload) => seen.push(payload))

    const wrapped = wrapBackgroundGeneratorWithTelemetry(fake, agentBus)
    await wrapped.generateContent({
      config: {temperature: 0},
      contents: [{content: 'hi', role: 'user'}],
      model: 'fake-model',
      taskId: 'task-no-usage',
    })

    expect(seen).to.have.lengthOf(0)
  })

  it('preserves estimateTokensSync delegation through the chain', () => {
    const fake = new FakeGenerator({content: 'ok', finishReason: 'stop'})
    const agentBus = new AgentEventBus()
    const wrapped = wrapBackgroundGeneratorWithTelemetry(fake, agentBus)
    const tokens = wrapped.estimateTokensSync('abcdefghij')
    expect(tokens).to.equal(3)
    expect(fake.estimateCalls).to.equal(1)
  })
})
