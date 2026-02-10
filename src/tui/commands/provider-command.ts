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

import axios, {isAxiosError} from 'axios'

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
 * API key placeholder hints per provider.
 * Falls back to 'sk-...' for unlisted providers.
 */
const API_KEY_PLACEHOLDERS: Readonly<Record<string, string>> = {
  anthropic: 'sk-ant-...',
  cerebras: 'csk-...',
  cohere: '...',
  deepinfra: '...',
  groq: 'gsk_...',
  mistral: '...',
  openai: 'sk-...',
  openrouter: 'sk-or-...',
  perplexity: 'pplx-...',
  togetherai: '...',
  vercel: 'vcp_...',
  xai: 'xai-...',
}

/**
 * Determine connection source for a provider.
 */
type ConnectionSource = 'env' | 'keychain' | 'none'

async function getConnectionSource(
  providerId: string,
  keychainStore: ProviderKeychainStore,
  configStore?: FileProviderConfigStore,
): Promise<ConnectionSource> {
  if (providerId === 'byterover') return 'keychain' // Internal provider, always "connected"
  if (providerId === 'google-vertex') {
    // Vertex AI uses ADC — check if GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS are set
    if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS) return 'env'

    return 'none'
  }

  // OpenAI Compatible: connected if a base URL is stored in config
  if (providerId === 'openai-compatible' && configStore) {
    const config = await configStore.read()
    if (config.getBaseUrl(providerId)) return 'keychain'

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
      source: await getConnectionSource(provider.id, keychainStore, configStore),
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
      const source = await getConnectionSource(provider.id, keychainStore, configStore)
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
              placeholder: API_KEY_PLACEHOLDERS[provider.id] ?? 'sk-...',
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
      } else if (provider.id === 'openai-compatible') {
        // OpenAI Compatible: prompt for base URL, then optional API key
        onMessage({
          content: 'Enter the base URL of your OpenAI-compatible endpoint.\nExamples: http://localhost:11434/v1 (Ollama), http://localhost:1234/v1 (LM Studio)',
          id: `info-${Date.now()}`,
          type: 'output',
        })

        const baseUrl = await new Promise<string>((resolve) => {
          onPrompt({
            message: 'Base URL',
            onResponse: resolve,
            placeholder: 'http://localhost:11434/v1',
            type: 'input',
            validate(value: string) {
              if (!value.trim()) return 'Base URL is required'
              if (!URL.canParse(value.trim())) return 'Invalid URL format'

              return true
            },
          })
        })

        const trimmedBaseUrl = baseUrl.trim()

        // Ask if API key is needed
        const needsKey = await new Promise<string>((resolve) => {
          onPrompt({
            choices: [
              {description: 'Most local LLMs do not require a key', name: 'No', value: 'no'},
              {description: 'Some endpoints require authentication', name: 'Yes', value: 'yes'},
            ],
            message: 'Does this endpoint require an API key?',
            onResponse: (value: unknown) => resolve(value as string),
            type: 'select',
          })
        })

        let apiKey = ''
        if (needsKey === 'yes') {
          apiKey = await new Promise<string>((resolve) => {
            onPrompt({
              message: 'Enter API key',
              onResponse: resolve,
              placeholder: 'sk-...',
              type: 'input',
              validate(value: string) {
                if (!value.trim()) return 'API key is required'

                return true
              },
            })
          })
        }

        // Validate connectivity by hitting the endpoint
        onMessage({
          actionId: 'validate-endpoint',
          content: 'Validating endpoint...',
          id: `validating-${Date.now()}`,
          type: 'action_start',
        })

        const validationResult = await validateOpenAICompatibleEndpoint(trimmedBaseUrl, apiKey)

        if (validationResult.isValid) {
          onMessage({
            actionId: 'validate-endpoint',
            content: 'Valid',
            id: `validated-${Date.now()}`,
            type: 'action_stop',
          })

          // Store API key if provided
          if (apiKey) {
            await keychainStore.setApiKey(provider.id, apiKey)
          }

          // Connect with the base URL stored in config
          await configStore.connectProvider(provider.id, {baseUrl: trimmedBaseUrl})

          onMessage({
            content: `Connected to ${provider.name} at ${trimmedBaseUrl}`,
            id: `connected-${Date.now()}`,
            type: 'output',
          })
        } else {
          onMessage({
            actionId: 'validate-endpoint',
            content: 'Failed',
            id: `invalid-${Date.now()}`,
            type: 'action_stop',
          })
          onMessage({
            content: validationResult.error ?? 'Could not connect to the endpoint. Please check the URL and try again.',
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

/* eslint-disable camelcase */
/**
 * Validate an OpenAI-compatible endpoint by trying /models then /chat/completions.
 */
async function validateOpenAICompatibleEndpoint(
  baseUrl: string,
  apiKey: string,
): Promise<{error?: string; isValid: boolean}> {
  const headers: Record<string, string> = {'Content-Type': 'application/json'}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  // Try GET /models first (works for most OpenAI-compatible servers)
  try {
    await axios.get(`${baseUrl}/models`, {headers, timeout: 10_000})

    return {isValid: true}
  } catch {
    // /models failed — fall through to chat/completions
  }

  // Try POST /chat/completions as fallback
  try {
    await axios.post(
      `${baseUrl}/chat/completions`,
      {
        max_tokens: 1,
        messages: [{content: 'hi', role: 'user'}],
        model: 'test',
      },
      {headers, timeout: 10_000},
    )

    return {isValid: true}
  } catch (error) {
    if (isAxiosError(error)) {
      // 401/403 means the endpoint exists but needs auth
      if (error.response?.status === 401 || error.response?.status === 403) {
        return {error: 'Authentication failed. Please check your API key.', isValid: false}
      }

      // 404 on both endpoints means this isn't an OpenAI-compatible API
      if (error.response?.status === 404) {
        return {error: 'Endpoint does not appear to be OpenAI-compatible (404 on /models and /chat/completions).', isValid: false}
      }

      // Other errors (400, 422, 500, etc.) mean the endpoint is reachable
      if (error.response) {
        return {isValid: true}
      }

      // Network errors
      return {error: `Could not reach endpoint: ${error.message}`, isValid: false}
    }

    return {error: error instanceof Error ? error.message : 'Unknown error', isValid: false}
  }
}
