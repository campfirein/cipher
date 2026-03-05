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

function createProviderConfig(activeProvider: string, providers: Record<string, {activeModel?: string; baseUrl?: string}> = {}): ProviderConfig {
  const providerEntries: Record<string, {activeModel?: string; baseUrl?: string; connectedAt: string; favoriteModels: string[]; recentModels: string[]}> = {}
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
    configStore.read.resolves(createProviderConfig('openai-compatible', {
      'openai-compatible': {activeModel: 'local-model', baseUrl: 'http://localhost:8080'},
    }))
    keychainStore.getApiKey.resolves('test-key')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('openai-compatible')
    expect(result.provider).to.equal('openai-compatible')
    expect(result.providerApiKey).to.equal('test-key')
    expect(result.providerBaseUrl).to.equal('http://localhost:8080')
  })

  it('should resolve direct provider (anthropic) with API key and registry info', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(createProviderConfig('anthropic', {
      anthropic: {activeModel: 'claude-sonnet-4-20250514'},
    }))
    keychainStore.getApiKey.resolves('sk-ant-key')

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeProvider).to.equal('anthropic')
    expect(result.provider).to.equal('anthropic')
    expect(result.providerApiKey).to.equal('sk-ant-key')
    expect(result.activeModel).to.equal('claude-sonnet-4-20250514')
  })

  it('should return undefined model when provider has no active model', async () => {
    const {configStore, keychainStore} = createStubStores(sandbox)
    configStore.read.resolves(createProviderConfig('byterover'))

    const result = await resolveProviderConfig(configStore, keychainStore)

    expect(result.activeModel).to.be.undefined
  })

})
