/* eslint-disable camelcase */
import {createAnthropic} from '@ai-sdk/anthropic'
import {expect} from 'chai'

import {AiSdkContentGenerator} from '../../../../../src/agent/infra/llm/generators/ai-sdk-content-generator.js'

interface CapturedRequest {
  body: Record<string, unknown>
  url: string
}

function makeMockAnthropicFetch(): {capturedRequests: CapturedRequest[]; fetch: typeof globalThis.fetch} {
  const capturedRequests: CapturedRequest[] = []

  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const rawBody = init?.body as string | undefined
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
    capturedRequests.push({body, url})

    // Minimal Anthropic Messages API success response
    const response = {
      content: [{text: 'ok', type: 'text'}],
      id: 'msg_test',
      model: (body.model as string | undefined) ?? 'claude-test',
      role: 'assistant',
      stop_reason: 'end_turn',
      stop_sequence: null,
      type: 'message',
      usage: {input_tokens: 1, output_tokens: 1},
    }

    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    return new Response(JSON.stringify(response), {
      headers: {'content-type': 'application/json'},
      status: 200,
    })
  }

  return {capturedRequests, fetch: mockFetch}
}

describe('AiSdkContentGenerator sampling-parameter gating', () => {
  it('omits temperature/top_p/top_k from the Anthropic request when excludeSamplingParameters is true', async () => {
    const {capturedRequests, fetch} = makeMockAnthropicFetch()
    const provider = createAnthropic({apiKey: 'test-key', fetch})

    const generator = new AiSdkContentGenerator({
      excludeSamplingParameters: true,
      model: provider('claude-opus-4-7'),
    })

    await generator.generateContent({
      config: {maxTokens: 16, temperature: 0.7, topK: 40, topP: 0.9},
      contents: [{content: 'hi', role: 'user'}],
      model: 'claude-opus-4-7',
      taskId: 'test-task',
    })

    expect(capturedRequests.length).to.equal(1)
    const {body} = capturedRequests[0]
    expect(body).to.not.have.property('temperature')
    expect(body).to.not.have.property('top_p')
    expect(body).to.not.have.property('top_k')
  })

  it('passes temperature/top_p/top_k through when excludeSamplingParameters is false', async () => {
    const {capturedRequests, fetch} = makeMockAnthropicFetch()
    const provider = createAnthropic({apiKey: 'test-key', fetch})

    const generator = new AiSdkContentGenerator({
      excludeSamplingParameters: false,
      model: provider('claude-opus-4-6'),
    })

    await generator.generateContent({
      config: {maxTokens: 16, temperature: 0.7, topK: 40, topP: 0.9},
      contents: [{content: 'hi', role: 'user'}],
      model: 'claude-opus-4-6',
      taskId: 'test-task',
    })

    expect(capturedRequests.length).to.equal(1)
    const {body} = capturedRequests[0]
    expect(body.temperature).to.equal(0.7)
    expect(body.top_p).to.equal(0.9)
    expect(body.top_k).to.equal(40)
  })
})
