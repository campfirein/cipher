import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IProviderConfigStore} from '../../../../../src/server/core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../../../../src/server/core/interfaces/i-provider-keychain-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {ProviderHandler} from '../../../../../src/server/infra/transport/handlers/provider-handler.js'
import {ProviderEvents} from '../../../../../src/shared/transport/events/provider-events.js'

// ==================== Test Helpers ====================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any, clientId: string) => any

function createMockTransport(): SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>} {
  const handlers = new Map<string, AnyHandler>()
  return {
    _handlers: handlers,
    addToRoom: stub(),
    broadcast: stub(),
    broadcastTo: stub(),
    getPort: stub(),
    isRunning: stub(),
    onConnection: stub(),
    onDisconnection: stub(),
    onRequest: stub().callsFake((event: string, handler: AnyHandler) => {
      handlers.set(event, handler)
    }),
    removeFromRoom: stub(),
    sendTo: stub(),
    start: stub(),
    stop: stub(),
  } as unknown as SinonStubbedInstance<ITransportServer> & {_handlers: Map<string, AnyHandler>}
}

// ==================== Tests ====================

describe('ProviderHandler', () => {
  let providerConfigStore: SinonStubbedInstance<IProviderConfigStore>
  let providerKeychainStore: SinonStubbedInstance<IProviderKeychainStore>
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    providerConfigStore = {
      connectProvider: stub().resolves(),
      disconnectProvider: stub().resolves(),
      getActiveModel: stub().resolves(),
      getActiveProvider: stub().resolves('byterover'),
      getFavoriteModels: stub().resolves([]),
      getRecentModels: stub().resolves([]),
      isProviderConnected: stub().resolves(false),
      read: stub().resolves(),
      setActiveModel: stub().resolves(),
      setActiveProvider: stub().resolves(),
      toggleFavorite: stub().resolves(),
      write: stub().resolves(),
    } as unknown as SinonStubbedInstance<IProviderConfigStore>

    providerKeychainStore = {
      deleteApiKey: stub().resolves(),
      getApiKey: stub().resolves(),
      hasApiKey: stub().resolves(false),
      setApiKey: stub().resolves(),
    } as unknown as SinonStubbedInstance<IProviderKeychainStore>

    transport = createMockTransport()
  })

  afterEach(() => {
    restore()
  })

  function createHandler(): ProviderHandler {
    const handler = new ProviderHandler({
      providerConfigStore,
      providerKeychainStore,
      transport,
    })
    handler.setup()
    return handler
  }

  describe('setup', () => {
    it('should register all provider event handlers', () => {
      createHandler()

      expect(transport._handlers.has(ProviderEvents.LIST)).to.be.true
      expect(transport._handlers.has(ProviderEvents.CONNECT)).to.be.true
      expect(transport._handlers.has(ProviderEvents.DISCONNECT)).to.be.true
      expect(transport._handlers.has(ProviderEvents.SET_ACTIVE)).to.be.true
      expect(transport._handlers.has(ProviderEvents.VALIDATE_API_KEY)).to.be.true
    })
  })

  describe('provider:connect', () => {
    it('should broadcast provider:updated after connecting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.CONNECT)
      const result = await handler!({apiKey: 'test-key', providerId: 'openrouter'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect(transport.broadcast.calledOnce).to.be.true
      expect(transport.broadcast.calledWith('provider:updated', {})).to.be.true
    })

    it('should store API key before connecting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.CONNECT)
      await handler!({apiKey: 'test-key', providerId: 'openrouter'}, 'client-1')

      expect(providerKeychainStore.setApiKey.calledBefore(providerConfigStore.connectProvider)).to.be.true
    })

    it('should broadcast after connectProvider completes', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.CONNECT)
      await handler!({providerId: 'byterover'}, 'client-1')

      expect(providerConfigStore.connectProvider.calledBefore(transport.broadcast)).to.be.true
    })
  })

  describe('provider:disconnect', () => {
    it('should broadcast provider:updated after disconnecting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.DISCONNECT)
      const result = await handler!({providerId: 'openrouter'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect(transport.broadcast.calledOnce).to.be.true
      expect(transport.broadcast.calledWith('provider:updated', {})).to.be.true
    })

    it('should delete API key for providers that require one', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.DISCONNECT)
      await handler!({providerId: 'openrouter'}, 'client-1')

      expect(providerKeychainStore.deleteApiKey.calledWith('openrouter')).to.be.true
    })

    it('should broadcast after disconnectProvider completes', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.DISCONNECT)
      await handler!({providerId: 'openrouter'}, 'client-1')

      expect(providerConfigStore.disconnectProvider.calledBefore(transport.broadcast)).to.be.true
    })
  })

  describe('provider:setActive', () => {
    it('should broadcast provider:updated after setting active provider', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.SET_ACTIVE)
      const result = await handler!({providerId: 'openrouter'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect(transport.broadcast.calledOnce).to.be.true
      expect(transport.broadcast.calledWith('provider:updated', {})).to.be.true
    })

    it('should set active provider before broadcasting', async () => {
      createHandler()

      const handler = transport._handlers.get(ProviderEvents.SET_ACTIVE)
      await handler!({providerId: 'openrouter'}, 'client-1')

      expect(providerConfigStore.setActiveProvider.calledWith('openrouter')).to.be.true
      expect(providerConfigStore.setActiveProvider.calledBefore(transport.broadcast)).to.be.true
    })
  })
})
