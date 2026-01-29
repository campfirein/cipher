/**
 * Model Command
 *
 * Interactive command for selecting LLM models from the active provider.
 * Uses the streaming command pattern with inline prompts.
 *
 * Usage: /model
 */

import type {PromptChoice, PromptRequest, SlashCommand, StreamingMessage} from '../../../tui/types.js'

import {getProviderById} from '../../../core/domain/entities/provider-registry.js'
import {CommandKind} from '../../../tui/types.js'
import {getOpenRouterApiClient} from '../../http/openrouter-api-client.js'
import {FileProviderConfigStore} from '../../storage/file-provider-config-store.js'
import {ProviderKeychainStore} from '../../storage/provider-keychain-store.js'

/**
 * Format price for display.
 * Shows prices in a compact format: <0.01 for tiny prices, otherwise 2 decimal places.
 */
function formatPrice(pricePerM: number): string {
  if (pricePerM === 0) return '0'
  if (pricePerM < 0.01) return '<0.01'
  return pricePerM.toFixed(2)
}

/**
 * Build model choices for selection prompt.
 */
async function buildModelChoices(
  providerId: string,
  apiKey: string,
  config: {
    activeModel?: string
    favorites: readonly string[]
    recent: readonly string[]
  },
): Promise<Array<PromptChoice<string>>> {
  const choices: Array<PromptChoice<string>> = []

  if (providerId === 'openrouter') {
    const client = getOpenRouterApiClient()
    const models = await client.fetchModels(apiKey)

    // Sort models: favorites first, then recent, then by provider
    const sortedModels = [...models].sort((a, b) => {
      const aIsFavorite = config.favorites.includes(a.id)
      const bIsFavorite = config.favorites.includes(b.id)
      const aIsRecent = config.recent.includes(a.id)
      const bIsRecent = config.recent.includes(b.id)

      // Favorites first
      if (aIsFavorite && !bIsFavorite) return -1
      if (!aIsFavorite && bIsFavorite) return 1

      // Then recent
      if (aIsRecent && !bIsRecent) return -1
      if (!aIsRecent && bIsRecent) return 1

      // Then by provider
      const providerCompare = a.provider.localeCompare(b.provider)
      if (providerCompare !== 0) return providerCompare

      // Then by name
      return a.name.localeCompare(b.name)
    })

    for (const model of sortedModels) {
      const isCurrent = model.id === config.activeModel
      const isFavorite = config.favorites.includes(model.id)

      // Build indicators
      const indicators: string[] = []
      if (isCurrent) indicators.push('(Current)')
      if (isFavorite && !isCurrent) indicators.push('★')
      if (model.isFree && !isCurrent) indicators.push('[Free]')

      const statusSuffix = indicators.length > 0 ? ` ${indicators.join(' ')}` : ''

      // Build description with pricing and context
      const descParts: string[] = []
      if (model.provider) descParts.push(model.provider)
      if (!model.isFree && model.pricing) {
        // Show input/output pricing separately for more clarity
        const inputPrice = formatPrice(model.pricing.inputPerM)
        const outputPrice = formatPrice(model.pricing.outputPerM)
        descParts.push(`$${inputPrice}/$${outputPrice}/M`)
      }

      if (model.contextLength) {
        if (model.contextLength >= 1_000_000) {
          descParts.push(`${(model.contextLength / 1_000_000).toFixed(1)}M ctx`)
        } else if (model.contextLength >= 1000) {
          descParts.push(`${Math.round(model.contextLength / 1000)}K ctx`)
        }
      }

      choices.push({
        description: descParts.join(' • '),
        name: `${model.name}${statusSuffix}`,
        value: model.id,
      })
    }
  } else if (providerId === 'byterover') {
    // ByteRover internal - show a single option
    choices.push({
      description: 'Internal ByteRover model',
      name: 'ByteRover Default (Current)',
      value: 'byterover-default',
    })
  }

  return choices
}

/**
 * Model command definition.
 */
export const modelCommand: SlashCommand = {
  action: () => ({
    async execute(
      onMessage: (msg: StreamingMessage) => void,
      onPrompt: (prompt: PromptRequest) => void,
    ): Promise<void> {
      const configStore = new FileProviderConfigStore()
      const keychainStore = new ProviderKeychainStore()

      // Get active provider
      const config = await configStore.read()
      const activeProviderId = config.activeProvider

      const provider = getProviderById(activeProviderId)
      if (!provider) {
        onMessage({
          content: `Active provider "${activeProviderId}" not found. Run /provider to select a provider.`,
          id: `error-${Date.now()}`,
          type: 'error',
        })
        return
      }

      // ByteRover doesn't support model selection
      if (activeProviderId === 'byterover') {
        onMessage({
          content: 'ByteRover uses an internal model. Run /provider to switch to an external provider for model selection.',
          id: `info-${Date.now()}`,
          type: 'output',
        })
        return
      }

      // Get API key for the provider
      const apiKey = await keychainStore.getApiKey(activeProviderId)
      if (!apiKey) {
        onMessage({
          content: `No API key found for ${provider.name}. Run /provider to connect.`,
          id: `error-${Date.now()}`,
          type: 'error',
        })
        return
      }

      // Fetch models
      onMessage({
        actionId: 'fetch-models',
        content: `Fetching models from ${provider.name}...`,
        id: `loading-${Date.now()}`,
        type: 'action_start',
      })

      let choices: Array<PromptChoice<string>>
      try {
        const activeModel = await configStore.getActiveModel(activeProviderId)
        const favorites = await configStore.getFavoriteModels(activeProviderId)
        const recent = await configStore.getRecentModels(activeProviderId)

        choices = await buildModelChoices(activeProviderId, apiKey, {
          activeModel,
          favorites,
          recent,
        })

        onMessage({
          actionId: 'fetch-models',
          content: `Found ${choices.length} models`,
          id: `loaded-${Date.now()}`,
          type: 'action_stop',
        })
      } catch (error) {
        onMessage({
          actionId: 'fetch-models',
          content: 'Failed',
          id: `error-${Date.now()}`,
          type: 'action_stop',
        })
        onMessage({
          content: error instanceof Error ? error.message : 'Failed to fetch models',
          id: `error-details-${Date.now()}`,
          type: 'error',
        })
        return
      }

      if (choices.length === 0) {
        onMessage({
          content: 'No models available from this provider.',
          id: `empty-${Date.now()}`,
          type: 'output',
        })
        return
      }

      // Show model selection
      const selectedModelId = await new Promise<string>((resolve) => {
        onPrompt({
          choices,
          message: `Select a model (${provider.name})`,
          onResponse: (value: unknown) => resolve(value as string),
          type: 'select',
        })
      })

      // Save selected model
      await configStore.setActiveModel(activeProviderId, selectedModelId)

      onMessage({
        content: `Model set to: ${selectedModelId}`,
        id: `selected-${Date.now()}`,
        type: 'output',
      })
    },
    type: 'streaming',
  }),
  aliases: ['models'],
  autoExecute: true,
  description: 'Select a model from the active provider',
  kind: CommandKind.BUILT_IN,
  name: 'model',
}
