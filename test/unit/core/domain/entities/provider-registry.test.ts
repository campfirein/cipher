import {expect} from 'chai'

import {
  getProviderById,
  PROVIDER_REGISTRY,
  providerRequiresApiKey,
} from '../../../../../src/server/core/domain/entities/provider-registry.js'

describe('Provider Registry', () => {
  describe('providerRequiresApiKey()', () => {
    it('should return true for non-internal providers with no authMethod', () => {
      expect(providerRequiresApiKey('openai')).to.be.true
      expect(providerRequiresApiKey('anthropic')).to.be.true
    })

    it('should return false for internal provider (byterover)', () => {
      expect(providerRequiresApiKey('byterover')).to.be.false
    })

    it('should return false for openai-compatible provider', () => {
      expect(providerRequiresApiKey('openai-compatible')).to.be.false
    })

    it('should return false when authMethod is oauth', () => {
      expect(providerRequiresApiKey('openai', 'oauth')).to.be.false
      expect(providerRequiresApiKey('anthropic', 'oauth')).to.be.false
      expect(providerRequiresApiKey('openrouter', 'oauth')).to.be.false
    })

    it('should return true when authMethod is api-key', () => {
      expect(providerRequiresApiKey('openai', 'api-key')).to.be.true
      expect(providerRequiresApiKey('anthropic', 'api-key')).to.be.true
    })

    it('should return true when authMethod is undefined (backward compat)', () => {
      expect(providerRequiresApiKey('openai')).to.be.true
    })

    it('should return false for unknown provider ID', () => {
      expect(providerRequiresApiKey('nonexistent')).to.be.false
    })
  })

  describe('OpenAI OAuth config', () => {
    it('should have oauth config defined', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth).to.not.be.undefined
    })

    it('should use auto callback mode', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth?.callbackMode).to.equal('auto')
    })

    it('should use port 1455 for callback', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth?.callbackPort).to.equal(1455)
    })

    it('should have correct redirect URI matching port and path', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth?.redirectUri).to.equal('http://localhost:1455/auth/callback')
    })

    it('should use form-encoded token content type', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth?.tokenContentType).to.equal('form')
    })

    it('should have a client ID', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth?.clientId).to.be.a('string').and.not.be.empty
    })

    it('should have at least one OAuth mode', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth?.modes).to.have.length.greaterThanOrEqual(1)
      expect(openai?.oauth?.modes[0].id).to.equal('default')
      expect(openai?.oauth?.modes[0].authUrl).to.include('auth.openai.com')
    })

    it('should include required OpenAI extra params', () => {
      const openai = getProviderById('openai')
      expect(openai?.oauth?.extraParams).to.include({
        // eslint-disable-next-line camelcase
        codex_cli_simplified_flow: 'true',
        // eslint-disable-next-line camelcase
        id_token_add_organizations: 'true',
        originator: 'byterover',
      })
    })
  })

  describe('providers without OAuth', () => {
    it('should not have oauth config for openai-compatible', () => {
      const provider = getProviderById('openai-compatible')
      expect(provider?.oauth).to.be.undefined
    })

    it('should not have oauth config for byterover', () => {
      const provider = getProviderById('byterover')
      expect(provider?.oauth).to.be.undefined
    })

    it('should not have oauth config for anthropic yet', () => {
      const provider = getProviderById('anthropic')
      expect(provider?.oauth).to.be.undefined
    })
  })

  describe('PROVIDER_REGISTRY structure', () => {
    it('should contain openai as a key', () => {
      expect(PROVIDER_REGISTRY).to.have.property('openai')
    })

    it('should have id matching the registry key for all providers', () => {
      for (const [key, def] of Object.entries(PROVIDER_REGISTRY)) {
        expect(def.id).to.equal(key)
      }
    })
  })

  describe('GitHub Copilot provider', () => {
    it('should be in the registry', () => {
      expect(PROVIDER_REGISTRY).to.have.property('github-copilot')
    })

    it('should have correct fields', () => {
      const copilot = getProviderById('github-copilot')
      expect(copilot).to.not.be.undefined
      expect(copilot?.id).to.equal('github-copilot')
      expect(copilot?.name).to.equal('GitHub Copilot')
      expect(copilot?.baseUrl).to.equal('https://api.githubcopilot.com')
      expect(copilot?.category).to.equal('popular')
      expect(copilot?.defaultModel).to.equal('claude-sonnet-4.6')
      expect(copilot?.priority).to.equal(8)
    })

    it('providerRequiresApiKey should return false', () => {
      expect(providerRequiresApiKey('github-copilot')).to.be.false
    })

    it('should have oauth config with callbackMode device', () => {
      const copilot = getProviderById('github-copilot')
      expect(copilot?.oauth).to.not.be.undefined
      expect(copilot?.oauth?.callbackMode).to.equal('device')
    })

    it('should have correct oauth clientId', () => {
      const copilot = getProviderById('github-copilot')
      expect(copilot?.oauth?.clientId).to.equal('Iv1.b507a08c87ecfe98')
    })

    it('should have oauth modes with GitHub device auth URL', () => {
      const copilot = getProviderById('github-copilot')
      expect(copilot?.oauth?.modes).to.have.length.greaterThanOrEqual(1)
      expect(copilot?.oauth?.modes[0].authUrl).to.include('github.com/login/device')
    })
  })
})
