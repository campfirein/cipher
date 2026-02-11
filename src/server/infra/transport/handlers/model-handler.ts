import type {ModelDTO} from '../../../../shared/transport/types/dto.js'
import type {IProviderConfigStore} from '../../../core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../../core/interfaces/i-provider-keychain-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  ModelEvents,
  type ModelListRequest,
  type ModelListResponse,
  type ModelSetActiveRequest,
  type ModelSetActiveResponse,
} from '../../../../shared/transport/events/model-events.js'
import {getProviderById} from '../../../core/domain/entities/provider-registry.js'
import {createOpenRouterApiClient} from '../../http/openrouter-api-client.js'

export interface ModelHandlerDeps {
  providerConfigStore: IProviderConfigStore
  providerKeychainStore: IProviderKeychainStore
  transport: ITransportServer
}

/**
 * Handles model:* events.
 * Business logic for model listing and selection — no terminal/UI calls.
 */
export class ModelHandler {
  private readonly providerConfigStore: IProviderConfigStore
  private readonly providerKeychainStore: IProviderKeychainStore
  private readonly transport: ITransportServer

  constructor(deps: ModelHandlerDeps) {
    this.providerConfigStore = deps.providerConfigStore
    this.providerKeychainStore = deps.providerKeychainStore
    this.transport = deps.transport
  }

  setup(): void {
    this.setupList()
    this.setupSetActive()
  }

  private setupList(): void {
    this.transport.onRequest<ModelListRequest, ModelListResponse>(ModelEvents.LIST, async (data) => {
      const {providerId} = data
      const provider = getProviderById(providerId)
      if (!provider) {
        return {favorites: [], models: [], recent: []}
      }

      // Fetch models from provider API
      const apiKey = await this.providerKeychainStore.getApiKey(providerId)
      if (!apiKey && provider.baseUrl.length > 0) {
        return {favorites: [], models: [], recent: []}
      }

      const client = createOpenRouterApiClient(provider)
      const normalizedModels = await client.fetchModels(apiKey ?? '')

      const models: ModelDTO[] = normalizedModels.map((m) => ({
        contextLength: m.contextLength,
        description: m.description,
        id: m.id,
        isFree: m.isFree,
        name: m.name,
        pricing: m.pricing,
        provider: m.provider,
      }))

      const [activeModel, favorites, recent] = await Promise.all([
        this.providerConfigStore.getActiveModel(providerId),
        this.providerConfigStore.getFavoriteModels(providerId),
        this.providerConfigStore.getRecentModels(providerId),
      ])

      return {
        activeModel,
        favorites: [...favorites],
        models,
        recent: [...recent],
      }
    })
  }

  private setupSetActive(): void {
    this.transport.onRequest<ModelSetActiveRequest, ModelSetActiveResponse>(ModelEvents.SET_ACTIVE, async (data) => {
      await this.providerConfigStore.setActiveModel(data.providerId, data.modelId)
      return {success: true}
    })
  }
}
