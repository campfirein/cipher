import {expect} from 'chai'

import {formatProviderModel} from '../../../../../../src/webui/features/tasks/utils/format-provider-model.js'

describe('formatProviderModel', () => {
  it('returns undefined when no provider', () => {
    expect(formatProviderModel()).to.equal(undefined)
  })

  it('returns "<provider>:<model>" for external providers', () => {
    expect(formatProviderModel('openai', 'gpt-5-pro')).to.equal('openai:gpt-5-pro')
    expect(formatProviderModel('anthropic', 'claude-sonnet-4-6')).to.equal('anthropic:claude-sonnet-4-6')
  })

  it('returns "<provider>" alone when model is missing (byterover internal)', () => {
    expect(formatProviderModel('byterover')).to.equal('byterover')
  })

  it('returns undefined when only model is set', () => {
    expect(formatProviderModel(undefined, 'gpt-5-pro')).to.equal(undefined)
  })

  it('treats empty strings as missing', () => {
    expect(formatProviderModel('', '')).to.equal(undefined)
    expect(formatProviderModel('', 'gpt-5-pro')).to.equal(undefined)
    expect(formatProviderModel('openai', '')).to.equal('openai')
  })

  it('uses providerName when provided for byterover-internal', () => {
    expect(formatProviderModel('byterover', undefined, 'ByteRover')).to.equal('ByteRover')
  })

  it('uses providerName when provided for external <provider>:<model>', () => {
    expect(formatProviderModel('openai', 'gpt-5-pro', 'OpenAI')).to.equal('OpenAI:gpt-5-pro')
  })

  it('falls back to provider id when providerName is empty or missing', () => {
    expect(formatProviderModel('openai', 'gpt-5-pro')).to.equal('openai:gpt-5-pro')
    expect(formatProviderModel('openai', 'gpt-5-pro', '')).to.equal('openai:gpt-5-pro')
    expect(formatProviderModel('byterover', undefined, '')).to.equal('byterover')
  })
})
