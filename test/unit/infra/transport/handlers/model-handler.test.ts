import {expect} from 'chai'
import {restore} from 'sinon'

import {TransportDaemonEventNames} from '../../../../../src/server/core/domain/transport/schemas.js'
import {ModelHandler} from '../../../../../src/server/infra/transport/handlers/model-handler.js'
import {ModelEvents} from '../../../../../src/shared/transport/events/model-events.js'
import {
  createMockProviderConfigStore,
  createMockProviderKeychainStore,
  createMockTransportServer,
} from '../../../../helpers/mock-factories.js'

// ==================== Tests ====================

describe('ModelHandler', () => {
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
      expect(transport.broadcast.calledWith(TransportDaemonEventNames.PROVIDER_UPDATED, {})).to.be.true
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
