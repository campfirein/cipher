import {expect} from 'chai'

import {getModelCapabilities} from '../../../../src/agent/infra/llm/model-capabilities.js'

describe('getModelCapabilities — DeepSeek', () => {
  it('reports native reasoning_content for deepseek-reasoner', () => {
    const caps = getModelCapabilities('deepseek-reasoner')
    expect(caps.reasoning).to.equal(true)
    expect(caps.reasoningField).to.equal('reasoning_content')
    expect(caps.reasoningFormat).to.equal('native-field')
  })

  it('reports native reasoning_content for deepseek-r1', () => {
    const caps = getModelCapabilities('deepseek-r1')
    expect(caps.reasoning).to.equal(true)
    expect(caps.reasoningField).to.equal('reasoning_content')
    expect(caps.reasoningFormat).to.equal('native-field')
  })

  it('reports no reasoning for deepseek-chat', () => {
    const caps = getModelCapabilities('deepseek-chat')
    expect(caps.reasoning).to.equal(false)
    expect(caps.reasoningFormat).to.equal('none')
  })
})
