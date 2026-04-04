import {expect} from 'chai'

import {deriveAppViewMode} from '../../../../../src/tui/features/onboarding/hooks/use-app-view-mode.js'

describe('deriveAppViewMode', () => {
  it('should return loading when isLoading is true', () => {
    const result = deriveAppViewMode({
      activeModel: 'gpt-4o',
      activeProviderId: 'openrouter',
      isAuthorized: true,
      isLoading: true,
    })

    expect(result).to.deep.equal({type: 'loading'})
  })

  it('should return config-provider when byterover and not authorized', () => {
    const result = deriveAppViewMode({
      activeProviderId: 'byterover',
      isAuthorized: false,
      isLoading: false,
    })

    expect(result).to.deep.equal({type: 'config-provider'})
  })

  it('should return ready when byterover and authorized', () => {
    const result = deriveAppViewMode({
      activeProviderId: 'byterover',
      isAuthorized: true,
      isLoading: false,
    })

    expect(result).to.deep.equal({type: 'ready'})
  })

  it('should return config-provider when non-byterover provider with no active model', () => {
    const result = deriveAppViewMode({
      activeProviderId: 'openrouter',
      isAuthorized: false,
      isLoading: false,
    })

    expect(result).to.deep.equal({type: 'config-provider'})
  })

  it('should return ready when non-byterover provider with active model', () => {
    const result = deriveAppViewMode({
      activeModel: 'gpt-4o',
      activeProviderId: 'openrouter',
      isAuthorized: false,
      isLoading: false,
    })

    expect(result).to.deep.equal({type: 'ready'})
  })

  it('should return config-provider when no active provider (undefined)', () => {
    const result = deriveAppViewMode({
      isAuthorized: false,
      isLoading: false,
    })

    expect(result).to.deep.equal({type: 'config-provider'})
  })

  it('should return config-provider when active provider is empty string (post-disconnect)', () => {
    const result = deriveAppViewMode({
      activeProviderId: '',
      isAuthorized: true,
      isLoading: false,
    })

    expect(result).to.deep.equal({type: 'config-provider'})
  })
})
