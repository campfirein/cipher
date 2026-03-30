/* eslint-disable camelcase */
import {expect} from 'chai'
import {restore, type SinonStub, stub} from 'sinon'

import {createChatGptOAuthFetch} from '../../../../../src/agent/infra/llm/providers/openai.js'

describe('createChatGptOAuthFetch', () => {
  let fetchStub: SinonStub
  let customFetch: typeof globalThis.fetch

  beforeEach(() => {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    fetchStub = stub(globalThis, 'fetch').resolves(new Response('ok'))
    customFetch = createChatGptOAuthFetch()
  })

  afterEach(() => {
    restore()
  })

  it('should set instructions to empty string when missing', async () => {
    const body = JSON.stringify({model: 'gpt-5.3-codex'})
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.instructions).to.equal('')
  })

  it('should preserve existing instructions', async () => {
    const body = JSON.stringify({instructions: 'Be helpful', model: 'gpt-5.3-codex'})
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.instructions).to.equal('Be helpful')
  })

  it('should set store to false', async () => {
    const body = JSON.stringify({model: 'gpt-5.3-codex', store: true})
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.store).to.equal(false)
  })

  it('should delete max_output_tokens', async () => {
    const body = JSON.stringify({max_output_tokens: 4096, model: 'gpt-5.3-codex'})
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody).to.not.have.property('max_output_tokens')
  })

  it('should remove id from input items', async () => {
    const body = JSON.stringify({
      input: [
        {content: 'hello', id: 'msg-1', role: 'user'},
        {content: 'world', id: 'msg-2', role: 'assistant'},
      ],
      model: 'gpt-5.3-codex',
    })
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    for (const item of calledBody.input) {
      expect(item).to.not.have.property('id')
    }

    expect(calledBody.input[0].content).to.equal('hello')
    expect(calledBody.input[1].content).to.equal('world')
  })

  it('should pass through non-POST requests unchanged', async () => {
    await customFetch('https://example.com/models', {method: 'GET'})

    expect(fetchStub.firstCall.args[1].method).to.equal('GET')
    expect(fetchStub.firstCall.args[1]).to.not.have.property('body')
  })

  it('should pass through when body is not a string', async () => {
    const bodyBuffer = Buffer.from('binary data')
    await customFetch('https://example.com', {body: bodyBuffer, method: 'POST'})

    expect(fetchStub.firstCall.args[1].body).to.equal(bodyBuffer)
  })

  it('should pass through when body is not valid JSON', async () => {
    const invalidJson = 'not-json{{'
    await customFetch('https://example.com', {body: invalidJson, method: 'POST'})

    expect(fetchStub.firstCall.args[1].body).to.equal(invalidJson)
  })

  it('should not modify input items without id', async () => {
    const body = JSON.stringify({
      input: [{content: 'hello', role: 'user'}],
      model: 'gpt-5.3-codex',
    })
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.input[0]).to.deep.equal({content: 'hello', role: 'user'})
  })

  it('should extract system role from input[0] into instructions', async () => {
    const body = JSON.stringify({
      input: [
        {content: 'You are a helpful assistant.', role: 'system'},
        {content: 'hello', role: 'user'},
      ],
      model: 'gpt-4.1',
    })
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.instructions).to.equal('You are a helpful assistant.')
    expect(calledBody.input).to.have.length(1)
    expect(calledBody.input[0].role).to.equal('user')
  })

  it('should extract developer role from input[0] into instructions', async () => {
    const body = JSON.stringify({
      input: [
        {content: 'You are a code assistant.', role: 'developer'},
        {content: 'write code', role: 'user'},
      ],
      model: 'gpt-5.1-codex-mini',
    })
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.instructions).to.equal('You are a code assistant.')
    expect(calledBody.input).to.have.length(1)
    expect(calledBody.input[0].role).to.equal('user')
  })

  it('should preserve existing instructions over system input item', async () => {
    const body = JSON.stringify({
      input: [
        {content: 'from input', role: 'system'},
        {content: 'hello', role: 'user'},
      ],
      instructions: 'already set',
      model: 'gpt-4.1',
    })
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.instructions).to.equal('already set')
    expect(calledBody.input).to.have.length(2)
    expect(calledBody.input[0].role).to.equal('system')
  })

  it('should not extract non-leading system messages', async () => {
    const body = JSON.stringify({
      input: [
        {content: 'hello', role: 'user'},
        {content: 'system note', role: 'system'},
      ],
      model: 'gpt-4.1',
    })
    await customFetch('https://example.com', {body, method: 'POST'})

    const calledBody = JSON.parse(fetchStub.firstCall.args[1].body)
    expect(calledBody.instructions).to.equal('')
    expect(calledBody.input).to.have.length(2)
  })

  describe('integration with AiSdkContentGenerator', () => {
    it('should extract system prompt into instructions when driven through real AI SDK path', async () => {
      restore() // Clear the beforeEach stub — we need a custom one

      const capturedBodies: Record<string, unknown>[] = []
      const integrationFetchStub = stub(globalThis, 'fetch').callsFake(async (_url, init) => {
        if (init && typeof init.body === 'string') {
          try {
            capturedBodies.push(JSON.parse(init.body))
          } catch { /* non-JSON body */ }
        }

        // Return a minimal valid OpenAI Responses API response
        // eslint-disable-next-line n/no-unsupported-features/node-builtins
        return new Response(JSON.stringify({
          id: 'resp-test',
          model: 'gpt-4.1',
          object: 'response',
          output: [{
            content: [{text: 'test response', type: 'output_text'}],
            id: 'msg-test',
            role: 'assistant',
            status: 'completed',
            type: 'message',
          }],
          usage: {input_tokens: 10, output_tokens: 5, total_tokens: 15},
        }), {
          headers: {'content-type': 'application/json'},
          status: 200,
        })
      })

      const {createOpenAI} = await import('@ai-sdk/openai')
      const {AiSdkContentGenerator} = await import('../../../../../src/agent/infra/llm/generators/ai-sdk-content-generator.js')

      const provider = createOpenAI({
        apiKey: 'test-key',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        fetch: createChatGptOAuthFetch(),
      })

      const generator = new AiSdkContentGenerator({
        model: provider.responses('gpt-4.1'),
      })

      try {
        await generator.generateContent({
          config: {maxTokens: 100, temperature: 0},
          contents: [{content: 'hello', role: 'user'}],
          model: 'default',
          systemPrompt: 'You are a technical documentation assistant.',
          taskId: 'test-task',
        })
      } catch {
        // Response parsing may fail — we only care about the request body
      }

      expect(integrationFetchStub.called).to.equal(true)
      const body = capturedBodies.find((b) => b.model === 'gpt-4.1')
      expect(body).to.not.be.undefined
      // System prompt should be in instructions, not in input[]
      expect(body!.instructions).to.be.a('string')
      expect((body!.instructions as string).length).to.be.greaterThan(0)
      // input should not contain a system/developer role item
      if (Array.isArray(body!.input)) {
        for (const item of body!.input as Array<Record<string, unknown>>) {
          expect(item.role).to.not.equal('system')
          expect(item.role).to.not.equal('developer')
        }
      }
    })
  })
})
