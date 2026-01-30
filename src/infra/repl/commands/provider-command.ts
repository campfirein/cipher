/**
 * Provider Command
 *
 * Interactive command for selecting and connecting LLM providers.
 * Uses the streaming command pattern with inline prompts.
 *
 * Usage: /provider
 */

import type {PromptChoice, PromptRequest, SlashCommand, StreamingMessage} from '../../../tui/types.js'

import {
  getProviderById,
  getProvidersSortedByPriority,
  providerRequiresApiKey,
} from '../../../core/domain/entities/provider-registry.js'
import {CommandKind} from '../../../tui/types.js'
import {getOpenRouterApiClient} from '../../http/openrouter-api-client.js'
import {FileProviderConfigStore} from '../../storage/file-provider-config-store.js'
import {ProviderKeychainStore} from '../../storage/provider-keychain-store.js'

/**
 * Build provider choices for selection prompt.
 */
async function buildProviderChoices(): Promise<Array<PromptChoice<string>>> {
  const configStore = new FileProviderConfigStore()
  const keychainStore = new ProviderKeychainStore()
  const config = await configStore.read()
  const providers = getProvidersSortedByPriority()

  const choices: Array<PromptChoice<string>> = []

  // Check connection status for all providers
  const connectionStatuses = await Promise.all(
    providers.map(async (provider) => ({
      isConnected: provider.id === 'byterover' || (await keychainStore.hasApiKey(provider.id)),
      provider,
    })),
  )

  for (const {isConnected, provider} of connectionStatuses) {
    const isCurrent = provider.id === config.activeProvider

    // Build status indicators
    const indicators: string[] = []
    if (isCurrent) indicators.push('(Current)')
    else if (isConnected) indicators.push('[Connected]')

    const statusSuffix = indicators.length > 0 ? ` ${indicators.join(' ')}` : ''

    choices.push({
      description: provider.description,
      name: `${provider.name}${statusSuffix}`,
      value: provider.id,
    })
  }

  return choices
}

/**
 * Validate API key for a provider.
 */
async function validateApiKey(apiKey: string, providerId: string): Promise<{error?: string; isValid: boolean}> {
  if (providerId === 'openrouter') {
    const client = getOpenRouterApiClient()
    return client.validateApiKey(apiKey)
  }

  // For other providers, assume valid
  return {isValid: true}
}

/**
 * Provider command definition.
 */
export const providerCommand: SlashCommand = {
  action: () => ({
    async execute(
      onMessage: (msg: StreamingMessage) => void,
      onPrompt: (prompt: PromptRequest) => void,
    ): Promise<void> {
      const configStore = new FileProviderConfigStore()
      const keychainStore = new ProviderKeychainStore()

      // Step 1: Show provider selection
      const choices = await buildProviderChoices()

      const selectedProviderId = await new Promise<string>((resolve) => {
        onPrompt({
          choices,
          message: 'Select a provider',
          onResponse: (value: unknown) => resolve(value as string),
          type: 'select',
        })
      })

      const provider = getProviderById(selectedProviderId)
      if (!provider) {
        onMessage({
          content: `Provider "${selectedProviderId}" not found`,
          id: `error-${Date.now()}`,
          type: 'error',
        })
        return
      }

      // Step 2: Check if already connected
      const isConnected = provider.id === 'byterover' || (await keychainStore.hasApiKey(provider.id))

      if (isConnected) {
        // Already connected - just set as active
        await configStore.setActiveProvider(provider.id)
        onMessage({
          content: `Switched to ${provider.name}`,
          id: `success-${Date.now()}`,
          type: 'output',
        })
        return
      }

      // Step 3: If provider requires API key, prompt for it
      if (providerRequiresApiKey(provider.id)) {
        onMessage({
          content: provider.apiKeyUrl
            ? `Get your API key at: ${provider.apiKeyUrl}`
            : `Enter your ${provider.name} API key`,
          id: `info-${Date.now()}`,
          type: 'output',
        })

        // Prompt for API key with validation
        let isValid = false
        let apiKey = ''

        while (!isValid) {
          // eslint-disable-next-line no-await-in-loop
          apiKey = await new Promise<string>((resolve) => {
            onPrompt({
              message: `Enter ${provider.name} API key`,
              onResponse: resolve,
              placeholder: 'sk-...',
              type: 'input',
              validate(value: string) {
                if (!value.trim()) return 'API key is required'
                return true
              },
            })
          })

          // Validate the API key
          onMessage({
            actionId: 'validate-key',
            content: 'Validating API key...',
            id: `validating-${Date.now()}`,
            type: 'action_start',
          })

          // eslint-disable-next-line no-await-in-loop
          const result = await validateApiKey(apiKey, provider.id)

          if (result.isValid) {
            isValid = true
            onMessage({
              actionId: 'validate-key',
              content: 'Valid',
              id: `validated-${Date.now()}`,
              type: 'action_stop',
            })
          } else {
            onMessage({
              actionId: 'validate-key',
              content: 'Invalid',
              id: `invalid-${Date.now()}`,
              type: 'action_stop',
            })
            onMessage({
              content: result.error ?? 'Invalid API key. Please try again.',
              id: `error-${Date.now()}`,
              type: 'error',
            })
          }
        }

        // Store API key in keychain
        await keychainStore.setApiKey(provider.id, apiKey)

        // Mark provider as connected and set as active
        await configStore.connectProvider(provider.id)

        onMessage({
          content: `Connected to ${provider.name}`,
          id: `connected-${Date.now()}`,
          type: 'output',
        })
      } else {
        // Provider doesn't require API key
        await configStore.connectProvider(provider.id)
        onMessage({
          content: `Switched to ${provider.name}`,
          id: `connected-${Date.now()}`,
          type: 'output',
        })
      }
    },
    type: 'streaming',
  }),
  aliases: ['providers', 'connect'],
  autoExecute: true,
  description: 'Connect to an LLM provider (e.g., OpenRouter)',
  kind: CommandKind.BUILT_IN,
  name: 'provider',
}
