import {expect} from 'chai'

import {getProviderModule} from '../../../../../src/agent/infra/llm/providers/index.js'

describe('deepseek provider module', () => {
  const mod = getProviderModule('deepseek')

  it('is registered', () => {
    expect(mod).to.not.be.undefined
  })

  it('uses api-key auth', () => {
    expect(mod?.authType).to.equal('api-key')
  })

  it('uses the openai provider type for formatter/tokenizer selection', () => {
    expect(mod?.providerType).to.equal('openai')
  })

  it('defaults to deepseek-chat', () => {
    expect(mod?.defaultModel).to.equal('deepseek-chat')
  })

  it('points at the official DeepSeek API base URL', () => {
    expect(mod?.baseUrl).to.equal('https://api.deepseek.com/v1')
  })

  it('exposes DEEPSEEK_API_KEY for env detection', () => {
    expect(mod?.envVars).to.include('DEEPSEEK_API_KEY')
  })
})
