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
})
