import {expect} from 'chai'
import {restore} from 'sinon'

import {TransportDaemonEventNames} from '../../../../../src/server/core/domain/transport/schemas.js'
import {ProviderHandler} from '../../../../../src/server/infra/transport/handlers/provider-handler.js'
import {ProviderEvents} from '../../../../../src/shared/transport/events/provider-events.js'
import {
  createMockProviderConfigStore,
  createMockProviderKeychainStore,
  createMockTransportServer,
} from '../../../../helpers/mock-factories.js'

// ==================== Tests ====================

describe('ProviderHandler', () => {
  let providerConfigStore: ReturnType<typeof createMockProviderConfigStore>
  let providerKeychainStore: ReturnType<typeof createMockProviderKeychainStore>
  let transport: ReturnType<typeof createMockTransportServer>

  beforeEach(() => {
    providerConfigStore = createMockProviderConfigStore()
    providerKeychainStore = createMockProviderKeychainStore()
    transport = createMockTransportServer()
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
      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
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
      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
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
      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
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
