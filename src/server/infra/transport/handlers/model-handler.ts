import type {ModelDTO} from '../../../../shared/transport/types/dto.js'
import type {IProviderConfigStore} from '../../../core/interfaces/i-provider-config-store.js'
import type {IProviderKeychainStore} from '../../../core/interfaces/i-provider-keychain-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  ModelEvents,
  type ModelListByProvidersRequest,
  type ModelListByProvidersResponse,
  type ModelListRequest,
  type ModelListResponse,
  type ModelSetActiveRequest,
  type ModelSetActiveResponse,
} from '../../../../shared/transport/events/model-events.js'
import {TransportDaemonEventNames} from '../../../core/domain/transport/schemas.js'
import {getModelFetcher} from '../../http/provider-model-fetcher-registry.js'

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
    this.setupListByProviders()
    this.setupSetActive()
  }

  private setupList(): void {
    this.transport.onRequest<ModelListRequest, ModelListResponse>(ModelEvents.LIST, async (data) => {
      const {providerId} = data
      const fetcher = await getModelFetcher(providerId)
      if (!fetcher) {
        return {favorites: [], models: [], recent: []}
      }

      // Fetch models from provider API using the correct per-provider fetcher
      const apiKey = await this.providerKeychainStore.getApiKey(providerId)
      const fetchedModels = await fetcher.fetchModels(apiKey ?? '')

      const models: ModelDTO[] = fetchedModels.map((m) => ({
        contextLength: m.contextLength,
        description: m.description,
        id: m.id,
        isFree: m.isFree,
        name: m.name,
        pricing: m.pricing,
        provider: m.provider,
        providerId,
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

  private setupListByProviders(): void {
    this.transport.onRequest<ModelListByProvidersRequest, ModelListByProvidersResponse>(
      ModelEvents.LIST_BY_PROVIDERS,
      async (data) => {
        const {providerIds} = data
        const models: ModelDTO[] = []

        await Promise.all(
          providerIds.map(async (providerId) => {
            const fetcher = await getModelFetcher(providerId)
            if (!fetcher) return

            const apiKey = await this.providerKeychainStore.getApiKey(providerId)
            const fetchedModels = await fetcher.fetchModels(apiKey ?? '')

            for (const model of fetchedModels) {
              models.push({
                contextLength: model.contextLength,
                description: model.description,
                id: model.id,
                isFree: model.isFree,
                name: model.name,
                pricing: model.pricing,
                provider: model.provider,
                providerId,
              })
            }
          }),
        )

        return {models}
      },
    )
  }

  private setupSetActive(): void {
    this.transport.onRequest<ModelSetActiveRequest, ModelSetActiveResponse>(ModelEvents.SET_ACTIVE, async (data) => {
      await this.providerConfigStore.setActiveProvider(data.providerId)
      await this.providerConfigStore.setActiveModel(data.providerId, data.modelId, data.contextLength)
      this.transport.broadcast(TransportDaemonEventNames.PROVIDER_UPDATED, {})
      return {success: true}
    })
  }
}
