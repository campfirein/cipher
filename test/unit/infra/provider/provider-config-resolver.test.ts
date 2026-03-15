import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStubbedInstance} from 'sinon'

import type {IProviderConfigStore} from '../../../../src/server/core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../../../src/server/core/interfaces/i-provider-keychain-store.js'

import {ProviderConfig} from '../../../../src/server/core/domain/entities/provider-config.js'
import {resolveProviderConfig} from '../../../../src/server/infra/provider/provider-config-resolver.js'

// ==================== Helpers ====================

function createStubStores(sandbox: SinonSandbox) {
  const configStore: SinonStubbedInstance<IProviderConfigStore> = {
    connectProvider: sandbox.stub().resolves(),
    disconnectProvider: sandbox.stub().resolves(),
    getActiveModel: sandbox.stub().resolves(),
    getActiveProvider: sandbox.stub().resolves('byterover'),
    getFavoriteModels: sandbox.stub().resolves([]),
    getRecentModels: sandbox.stub().resolves([]),
    isProviderConnected: sandbox.stub().resolves(false),
    read: sandbox.stub(),
    setActiveModel: sandbox.stub().resolves(),
    setActiveProvider: sandbox.stub().resolves(),
    toggleFavorite: sandbox.stub().resolves(),
    write: sandbox.stub().resolves(),
  } as unknown as SinonStubbedInstance<IProviderConfigStore>

  const keychainStore: SinonStubbedInstance<IProviderKeychainStore> = {
    deleteApiKey: sandbox.stub().resolves(),
    getApiKey: sandbox.stub().resolves(),
    hasApiKey: sandbox.stub().resolves(false),
    setApiKey: sandbox.stub().resolves(),
  } as unknown as SinonStubbedInstance<IProviderKeychainStore>

  return {configStore, keychainStore}
}

function createProviderConfig(
  activeProvider: string,
  providers: Record<
    string,
    {
      activeModel?: string
      authMethod?: 'api-key' | 'oauth'
      baseUrl?: string
      oauthAccountId?: string
      oauthExpiresAt?: string
      oauthRefreshToken?: string
    }
  > = {},
): ProviderConfig {
  const providerEntries: Record<
    string,
    {
      activeModel?: string
      authMethod?: 'api-key' | 'oauth'
      baseUrl?: string
      connectedAt: string
      favoriteModels: string[]
      oauthAccountId?: string
      oauthExpiresAt?: string
      oauthRefreshToken?: string
      recentModels: string[]
    }
  > = {}
  for (const [id, opts] of Object.entries(providers)) {
    providerEntries[id] = {
      ...opts,
      connectedAt: new Date().toISOString(),
      favoriteModels: [],
      recentModels: [],
    }
  }

  return ProviderConfig.fromJson({activeProvider, providers: providerEntries})
}

// ==================== Tests ====================

describe('resolveProviderConfig', () => {
  let sandbox: SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should return minimal config for byterover provider', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(createProviderConfig('byterover'))

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('byterover')
    expect(result.providerApiKey).to.be.undefined
    expect(result.providerBaseUrl).to.be.undefined
    // Should not attempt to read API key for byterover
    expect(keychainStore.getApiKey.called).to.be.false
  })

  it('should resolve API key from keychain for openrouter', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(createProviderConfig('openrouter', {openrouter: {activeModel: 'gpt-4o'}}))
    keychainStore.getApiKey.resolves('sk-or-key-123')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('openrouter')
    expect(result.activeModel).to.equal('gpt-4o')
    expect(result.openRouterApiKey).to.equal('sk-or-key-123')
    expect(result.provider).to.equal('openrouter')
  })

  it('should resolve openai-compatible provider with base URL', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai-compatible', {
        'openai-compatible': {activeModel: 'local-model', baseUrl: 'http://localhost:8080'},
      }),
    )
    keychainStore.getApiKey.resolves('test-key')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('openai-compatible')
    expect(result.provider).to.equal('openai-compatible')
    expect(result.providerApiKey).to.equal('test-key')
    expect(result.providerBaseUrl).to.equal('http://localhost:8080')
    expect(result.providerKeyMissing).to.be.false
  })

  it('should NOT set providerKeyMissing for openai-compatible without API key (Ollama use case)', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai-compatible', {
        'openai-compatible': {activeModel: 'qwen3.5:9b', baseUrl: 'http://localhost:11434/v1'},
      }),
    )
    keychainStore.getApiKey.resolves()

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('openai-compatible')
    expect(result.providerKeyMissing).to.be.false
    expect(result.providerBaseUrl).to.equal('http://localhost:11434/v1')
  })

  it('should resolve direct provider (anthropic) with API key and registry info', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('anthropic', {
        anthropic: {activeModel: 'claude-sonnet-4-20250514'},
      }),
    )
    keychainStore.getApiKey.resolves('sk-ant-key')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('anthropic')
    expect(result.provider).to.equal('anthropic')
    expect(result.providerApiKey).to.equal('sk-ant-key')
    expect(result.activeModel).to.equal('claude-sonnet-4-20250514')
  })

  it('should resolve OAuth-connected OpenAI with Codex URL and ChatGPT-Account-Id header', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai', {
        openai: {
          activeModel: 'gpt-4.1',
          authMethod: 'oauth',
          oauthAccountId: 'org-abc123',
        },
      }),
    )
    keychainStore.getApiKey.resolves('oauth-access-token-xyz')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('openai')
    expect(result.provider).to.equal('openai')
    expect(result.providerApiKey).to.equal('oauth-access-token-xyz')
    expect(result.providerBaseUrl).to.equal('https://chatgpt.com/backend-api/codex')
    expect(result.providerHeaders).to.deep.equal({'ChatGPT-Account-Id': 'org-abc123', originator: 'byterover'})
    expect(result.providerKeyMissing).to.be.false
  })

  it('should resolve OAuth-connected OpenAI without account ID (originator header only)', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai', {
        openai: {
          activeModel: 'gpt-4.1',
          authMethod: 'oauth',
        },
      }),
    )
    keychainStore.getApiKey.resolves('oauth-access-token-xyz')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.providerBaseUrl).to.equal('https://chatgpt.com/backend-api/codex')
    expect(result.providerHeaders).to.deep.equal({originator: 'byterover'})
    expect(result.providerKeyMissing).to.be.false
  })

  it('should resolve API-key-connected OpenAI with standard base URL (not Codex)', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai', {
        openai: {activeModel: 'gpt-4.1', authMethod: 'api-key'},
      }),
    )
    keychainStore.getApiKey.resolves('sk-openai-key')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('openai')
    expect(result.providerApiKey).to.equal('sk-openai-key')
    expect(result.providerBaseUrl).to.equal('https://api.openai.com/v1')
    expect(result.providerHeaders).to.be.undefined
    expect(result.providerKeyMissing).to.be.false
  })

  it('should set providerKeyMissing for API-key OpenAI without key', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai', {
        openai: {activeModel: 'gpt-4.1', authMethod: 'api-key'},
      }),
    )
    keychainStore.getApiKey.resolves()

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.providerKeyMissing).to.be.true
  })

  it('should use config baseUrl for non-OAuth provider when set', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('anthropic', {
        anthropic: {activeModel: 'claude-sonnet-4-20250514', baseUrl: 'https://custom-proxy.example.com'},
      }),
    )
    keychainStore.getApiKey.resolves('sk-ant-key')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.providerBaseUrl).to.equal('https://custom-proxy.example.com')
  })

  it('should resolve legacy OpenAI config without authMethod field (backward compat)', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai', {
        openai: {activeModel: 'gpt-4.1'},
      }),
    )
    keychainStore.getApiKey.resolves('sk-openai-key')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('openai')
    expect(result.providerApiKey).to.equal('sk-openai-key')
    expect(result.providerBaseUrl).to.equal('https://api.openai.com/v1')
    expect(result.providerHeaders).to.be.undefined
    expect(result.providerKeyMissing).to.be.false
  })

  it('should return providerKeyMissing false for OAuth OpenAI even when token is absent (race window)', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(
      createProviderConfig('openai', {
        openai: {
          activeModel: 'gpt-4.1',
          authMethod: 'oauth',
          oauthAccountId: 'org-abc123',
        },
      }),
    )
    keychainStore.getApiKey.resolves()

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.providerApiKey).to.be.undefined
    expect(result.providerKeyMissing).to.be.false
    expect(result.providerBaseUrl).to.equal('https://chatgpt.com/backend-api/codex')
  })

  it('should return undefined model when provider has no active model', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(createProviderConfig('byterover'))

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeModel).to.be.undefined
  })
})
