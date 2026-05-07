import {expect} from 'chai'

import {getProviderModule} from '../../../../../src/agent/infra/llm/providers/index.js'

describe('glm-coding-plan provider module', () => {
  const mod = getProviderModule('glm-coding-plan')

  it('is registered', () => {
    expect(mod).to.not.be.undefined
  })

  it('uses api-key auth', () => {
    expect(mod?.authType).to.equal('api-key')
  })

  it('uses the openai provider type for formatter/tokenizer selection', () => {
    expect(mod?.providerType).to.equal('openai')
  })

  it('defaults to glm-4.7', () => {
    expect(mod?.defaultModel).to.equal('glm-4.7')
  })

  it('points at the Z.AI Coding Plan endpoint', () => {
    expect(mod?.baseUrl).to.equal('https://api.z.ai/api/coding/paas/v4')
  })

  it('exposes ZHIPU_API_KEY for env detection', () => {
    expect(mod?.envVars).to.include('ZHIPU_API_KEY')
  })

  it('coexists with the standard glm provider', () => {
    const standard = getProviderModule('glm')
    expect(standard).to.not.be.undefined
    expect(standard?.baseUrl).to.not.equal(mod?.baseUrl)
  })
})
