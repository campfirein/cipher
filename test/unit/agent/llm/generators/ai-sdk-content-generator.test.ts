import type {ModelMessage} from 'ai'

import {expect} from 'chai'

import {prependCachedSystemMessage} from '../../../../../src/agent/infra/llm/generators/ai-sdk-content-generator.js'

describe('prependCachedSystemMessage', () => {
  const userMsg: ModelMessage = {content: 'hi', role: 'user'}

  it('returns the input messages unchanged when systemPrompt is undefined', () => {
    const result = prependCachedSystemMessage(undefined, [userMsg])
    expect(result).to.deep.equal([userMsg])
  })

  it('returns the input messages unchanged when systemPrompt is the empty string', () => {
    const result = prependCachedSystemMessage('', [userMsg])
    expect(result).to.deep.equal([userMsg])
  })

  it('prepends a system-role message with cacheControl providerOptions when systemPrompt is non-empty', () => {
    const result = prependCachedSystemMessage('You are a helpful assistant.', [userMsg])

    expect(result).to.have.length(2)

    const [system, user] = result
    expect(system.role).to.equal('system')
    expect(system.content).to.equal('You are a helpful assistant.')
    expect(system.providerOptions).to.deep.equal({
      anthropic: {cacheControl: {type: 'ephemeral'}},
    })
    expect(user).to.deep.equal(userMsg)
  })

  it('does not mutate the original messages array', () => {
    const original: ModelMessage[] = [userMsg]
    const result = prependCachedSystemMessage('sys', original)

    expect(original).to.have.length(1)
    expect(result).to.not.equal(original)
  })
})
