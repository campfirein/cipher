import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IProviderConfigStore} from '../../../../../src/server/core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../../../../src/server/core/interfaces/i-provider-keychain-store.js'
import type {ITransportServer} from '../../../../../src/server/core/interfaces/transport/i-transport-server.js'

import {ModelHandler} from '../../../../../src/server/infra/transport/handlers/model-handler.js'
import {ModelEvents} from '../../../../../src/shared/transport/events/model-events.js'

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

describe('ModelHandler', () => {
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

  function createHandler(): ModelHandler {
    const handler = new ModelHandler({
      providerConfigStore,
      providerKeychainStore,
      transport,
    })
    handler.setup()
    return handler
  }

  describe('setup', () => {
    it('should register model event handlers', () => {
      createHandler()

      expect(transport._handlers.has(ModelEvents.LIST)).to.be.true
      expect(transport._handlers.has(ModelEvents.SET_ACTIVE)).to.be.true
    })
  })

  describe('model:setActive', () => {
    it('should broadcast provider:updated after setting active model', async () => {
      createHandler()

      const handler = transport._handlers.get(ModelEvents.SET_ACTIVE)
      const result = await handler!({modelId: 'gpt-4', providerId: 'openrouter'}, 'client-1')

      expect(result).to.deep.equal({success: true})
      expect(transport.broadcast.calledOnce).to.be.true
      expect(transport.broadcast.calledWith('provider:updated', {})).to.be.true
    })

    it('should set active model before broadcasting', async () => {
      createHandler()

      const handler = transport._handlers.get(ModelEvents.SET_ACTIVE)
      await handler!({modelId: 'gpt-4', providerId: 'openrouter'}, 'client-1')

      expect(providerConfigStore.setActiveModel.calledWith('openrouter', 'gpt-4')).to.be.true
      expect(providerConfigStore.setActiveModel.calledBefore(transport.broadcast)).to.be.true
    })
  })
})
