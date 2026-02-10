/**
 * Provider Command
 *
 * Interactive command for selecting and connecting LLM providers.
 * Uses the streaming command pattern with inline prompts.
 *
 * Supports:
 * - Connect new providers (with API key validation)
 * - Switch between connected providers
 * - Disconnect / replace API keys for connected providers
 * - Auto-detect providers from environment variables
 *
 * Usage: /provider
 */

import type {PromptChoice, PromptRequest, SlashCommand, StreamingMessage} from '../../tui/types.js'

import {
  getProviderById,
  getProvidersSortedByPriority,
  providerRequiresApiKey,
} from '../../server/core/domain/entities/provider-registry.js'
import {validateApiKey as validateApiKeyViaFetcher} from '../../server/infra/http/provider-model-fetcher-registry.js'
import {getProviderApiKeyFromEnv} from '../../server/infra/provider/env-provider-detector.js'
import {FileProviderConfigStore} from '../../server/infra/storage/file-provider-config-store.js'
import {ProviderKeychainStore} from '../../server/infra/storage/provider-keychain-store.js'
import {CommandKind} from '../../tui/types.js'

/**
 * Determine connection source for a provider.
 */
type ConnectionSource = 'env' | 'keychain' | 'none'

async function getConnectionSource(
  providerId: string,
  keychainStore: ProviderKeychainStore,
): Promise<ConnectionSource> {
  if (providerId === 'byterover') return 'keychain' // Internal provider, always "connected"
  if (providerId === 'google-vertex') {
    // Vertex AI uses ADC — check if GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS are set
    if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS) return 'env'
    return 'none'
  }

  if (await keychainStore.hasApiKey(providerId)) return 'keychain'
  if (getProviderApiKeyFromEnv(providerId)) return 'env'
  return 'none'
}

/**
 * Build provider choices for selection prompt.
 */
async function buildProviderChoices(): Promise<Array<PromptChoice<string>>> {
  const configStore = new FileProviderConfigStore()
  const keychainStore = new ProviderKeychainStore()
  const config = await configStore.read()
  const providers = getProvidersSortedByPriority()

  const choices: Array<PromptChoice<string>> = []

  const connectionStatuses = await Promise.all(
    providers.map(async (provider) => ({
      provider,
      source: await getConnectionSource(provider.id, keychainStore),
    })),
  )

  for (const {provider, source} of connectionStatuses) {
    const isCurrent = provider.id === config.activeProvider

    // Build status indicators
    const indicators: string[] = []
    if (isCurrent) indicators.push('(Current)')
    else if (source === 'env') indicators.push('[ENV]')
    else if (source === 'keychain') indicators.push('[Connected]')

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

      // Step 2: Check connection source
      const source = await getConnectionSource(provider.id, keychainStore)
      const isConnected = source !== 'none'

      if (isConnected) {
        // Already connected — show actions menu
        const config = await configStore.read()
        const isCurrent = provider.id === config.activeProvider

        const actionChoices: Array<PromptChoice<string>> = []

        if (!isCurrent) {
          actionChoices.push({
            description: 'Make this the active provider',
            name: 'Set as active',
            value: 'activate',
          })
        }

        if (source === 'keychain') {
          actionChoices.push({
            description: 'Enter a new API key',
            name: 'Replace API key',
            value: 'replace',
          }, {
            description: 'Remove API key and disconnect',
            name: 'Disconnect',
            value: 'disconnect',
          })
        } else if (source === 'env') {
          actionChoices.push({
            description: 'Override env var key with a manual key',
            name: 'Override API key',
            value: 'replace',
          })
        }

        actionChoices.push({
          description: 'Go back',
          name: 'Cancel',
          value: 'cancel',
        })

        const action = await new Promise<string>((resolve) => {
          onPrompt({
            choices: actionChoices,
            message: `${provider.name} ${source === 'env' ? '(via env var)' : ''} — Choose action`,
            onResponse: (value: unknown) => resolve(value as string),
            type: 'select',
          })
        })

        switch (action) {
          case 'activate': {
            await configStore.setActiveProvider(provider.id)
            onMessage({
              content: `Switched to ${provider.name}`,
              id: `success-${Date.now()}`,
              type: 'output',
            })
            return
          }

          case 'disconnect': {
            await keychainStore.deleteApiKey(provider.id)
            await configStore.disconnectProvider(provider.id)
            onMessage({
              content: `Disconnected from ${provider.name}`,
              id: `disconnected-${Date.now()}`,
              type: 'output',
            })
            return
          }

          case 'replace': {
            // Fall through to the API key prompt below
            break
          }

          default: {
            return
          } // cancel
        }
      }

      // Step 3: If provider requires API key, check env first then prompt
      if (providerRequiresApiKey(provider.id)) {
        // Check for env var key (auto-connect without prompting)
        const envApiKey = getProviderApiKeyFromEnv(provider.id)
        if (envApiKey && !isConnected) {
          // Auto-connect using env var — no prompting needed
          await configStore.connectProvider(provider.id)

          onMessage({
            content: `Connected to ${provider.name} (API key from environment variable)`,
            id: `connected-${Date.now()}`,
            type: 'output',
          })
          return
        }

        // Prompt for API key
        onMessage({
          content: provider.apiKeyUrl
            ? `Get your API key at: ${provider.apiKeyUrl}`
            : `Enter your ${provider.name} API key`,
          id: `info-${Date.now()}`,
          type: 'output',
        })

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

          // Validate the API key using provider-specific fetcher
          onMessage({
            actionId: 'validate-key',
            content: 'Validating API key...',
            id: `validating-${Date.now()}`,
            type: 'action_start',
          })

          // eslint-disable-next-line no-await-in-loop
          const result = await validateApiKeyViaFetcher(apiKey, provider.id)

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
      } else if (provider.id === 'google-vertex') {
        // Vertex AI: validate ADC connectivity
        const project = process.env.GOOGLE_CLOUD_PROJECT
        if (!project) {
          onMessage({
            content: 'GOOGLE_CLOUD_PROJECT environment variable is required for Vertex AI',
            id: `error-${Date.now()}`,
            type: 'error',
          })
          return
        }

        onMessage({
          actionId: 'validate-vertex',
          content: 'Validating Vertex AI credentials...',
          id: `validating-${Date.now()}`,
          type: 'action_start',
        })

        const result = await validateApiKeyViaFetcher('', provider.id)

        if (result.isValid) {
          onMessage({
            actionId: 'validate-vertex',
            content: 'Valid',
            id: `validated-${Date.now()}`,
            type: 'action_stop',
          })
          await configStore.connectProvider(provider.id)
          const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
          onMessage({
            content: `Connected to ${provider.name} (project: ${project}, location: ${location})`,
            id: `connected-${Date.now()}`,
            type: 'output',
          })
        } else {
          onMessage({
            actionId: 'validate-vertex',
            content: 'Invalid',
            id: `invalid-${Date.now()}`,
            type: 'action_stop',
          })
          onMessage({
            content: result.error ?? 'Failed to authenticate with Vertex AI. Ensure GOOGLE_APPLICATION_CREDENTIALS is set.',
            id: `error-${Date.now()}`,
            type: 'error',
          })
        }
      } else {
        // Provider doesn't require API key (e.g., byterover)
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
  aliases: ['providers', 'connect', 'disconnect'],
  autoExecute: true,
  description: 'Connect, switch, or disconnect LLM providers',
  kind: CommandKind.BUILT_IN,
  name: 'provider',
}
