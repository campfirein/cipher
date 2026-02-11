import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'
import type {IProviderConfigStore} from '../../../core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../../core/interfaces/i-provider-keychain-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type ProviderConnectRequest,
  type ProviderConnectResponse,
  type ProviderDisconnectRequest,
  type ProviderDisconnectResponse,
  ProviderEvents,
  type ProviderListResponse,
  type ProviderSetActiveRequest,
  type ProviderSetActiveResponse,
  type ProviderValidateApiKeyRequest,
  type ProviderValidateApiKeyResponse,
} from '../../../../shared/transport/events/provider-events.js'
import {
  getProviderById,
  getProvidersSortedByPriority,
  providerRequiresApiKey,
} from '../../../core/domain/entities/provider-registry.js'
import {getErrorMessage} from '../../../utils/error-helpers.js'
import {createOpenRouterApiClient} from '../../http/openrouter-api-client.js'

export interface ProviderHandlerDeps {
  providerConfigStore: IProviderConfigStore
  providerKeychainStore: IProviderKeychainStore
  transport: ITransportServer
}

/**
 * Handles provider:* events.
 * Business logic for provider management — no terminal/UI calls.
 */
export class ProviderHandler {
  private readonly providerConfigStore: IProviderConfigStore
  private readonly providerKeychainStore: IProviderKeychainStore
  private readonly transport: ITransportServer

  constructor(deps: ProviderHandlerDeps) {
    this.providerConfigStore = deps.providerConfigStore
    this.providerKeychainStore = deps.providerKeychainStore
    this.transport = deps.transport
  }

  setup(): void {
    this.setupList()
    this.setupConnect()
    this.setupDisconnect()
    this.setupSetActive()
    this.setupValidateApiKey()
  }

  private setupConnect(): void {
    this.transport.onRequest<ProviderConnectRequest, ProviderConnectResponse>(ProviderEvents.CONNECT, async (data) => {
      const {apiKey, providerId} = data

      // Store API key if provided
      if (apiKey && providerRequiresApiKey(providerId)) {
        await this.providerKeychainStore.setApiKey(providerId, apiKey)
      }

      const provider = getProviderById(providerId)
      await this.providerConfigStore.connectProvider(providerId, {
        activeModel: provider?.defaultModel,
      })

      return {success: true}
    })
  }

  private setupDisconnect(): void {
    this.transport.onRequest<ProviderDisconnectRequest, ProviderDisconnectResponse>(
      ProviderEvents.DISCONNECT,
      async (data) => {
        const {providerId} = data

        await this.providerConfigStore.disconnectProvider(providerId)

        if (providerRequiresApiKey(providerId)) {
          await this.providerKeychainStore.deleteApiKey(providerId)
        }

        return {success: true}
      },
    )
  }

  private setupList(): void {
    this.transport.onRequest<void, ProviderListResponse>(ProviderEvents.LIST, async () => {
      const definitions = getProvidersSortedByPriority()
      const activeProviderId = await this.providerConfigStore.getActiveProvider()

      const providers: ProviderDTO[] = await Promise.all(
        definitions.map(async (def) => ({
          apiKeyUrl: def.apiKeyUrl,
          category: def.category,
          description: def.description,
          id: def.id,
          isConnected: await this.providerConfigStore.isProviderConnected(def.id),
          isCurrent: def.id === activeProviderId,
          name: def.name,
          requiresApiKey: providerRequiresApiKey(def.id),
        })),
      )

      return {providers}
    })
  }

  private setupSetActive(): void {
    this.transport.onRequest<ProviderSetActiveRequest, ProviderSetActiveResponse>(
      ProviderEvents.SET_ACTIVE,
      async (data) => {
        await this.providerConfigStore.setActiveProvider(data.providerId)
        return {success: true}
      },
    )
  }

  private setupValidateApiKey(): void {
    this.transport.onRequest<ProviderValidateApiKeyRequest, ProviderValidateApiKeyResponse>(
      ProviderEvents.VALIDATE_API_KEY,
      async (data) => {
        try {
          const provider = getProviderById(data.providerId)
          if (!provider) {
            return {error: 'Provider not found', isValid: false}
          }

          const client = createOpenRouterApiClient(provider)
          const result = await client.validateApiKey(data.apiKey)
          return result
        } catch (error) {
          return {error: getErrorMessage(error), isValid: false}
        }
      },
    )
  }
}
