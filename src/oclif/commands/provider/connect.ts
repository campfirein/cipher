import {Args, Command, Flags} from '@oclif/core'

import {
  ModelEvents,
  type ModelSetActiveResponse,
} from '../../../shared/transport/events/model-events.js'
import {
  type ProviderConnectResponse,
  ProviderEvents,
  type ProviderListResponse,
  type ProviderSetActiveResponse,
  type ProviderValidateApiKeyResponse,
} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ProviderConnect extends Command {
  public static args = {
    provider: Args.string({
      description: 'Provider ID to connect (e.g., anthropic, openai, openrouter)',
      required: true,
    }),
  }
  public static description = 'Connect or switch to an LLM provider'
  public static examples = [
    '<%= config.bin %> provider connect anthropic --api-key sk-xxx',
    '<%= config.bin %> provider connect openai --api-key sk-xxx --model gpt-4.1',
    '<%= config.bin %> provider connect byterover',
    '<%= config.bin %> provider connect openai-compatible --base-url http://localhost:11434/v1',
    '<%= config.bin %> provider connect openai-compatible --base-url http://localhost:11434/v1 --api-key sk-xxx --model llama3',
  ]
  public static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'API key for the provider',
    }),
    'base-url': Flags.string({
      char: 'b',
      description: 'Base URL for OpenAI-compatible providers (e.g., http://localhost:11434/v1)',
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    model: Flags.string({
      char: 'm',
      description: 'Model to set as active after connecting',
    }),
  }

  protected async connectProvider(
    {apiKey, baseUrl, model, providerId}: {apiKey?: string; baseUrl?: string; model?: string; providerId: string},
    options?: DaemonClientOptions,
  ) {
    return withDaemonRetry(async (client) => {
      // 1. Verify provider exists
      const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        throw new Error(`Unknown provider "${providerId}". Run "brv provider list" to see available providers.`)
      }

      // 2. Validate base URL for openai-compatible
      if (providerId === 'openai-compatible') {
        if (!baseUrl && !provider.isConnected) {
          throw new Error(
            'Provider "openai-compatible" requires a base URL. Use the --base-url flag to provide one.'
            + '\nExample: brv provider connect openai-compatible --base-url http://localhost:11434/v1',
          )
        }

        if (baseUrl) {
          let parsed: undefined | URL
          try {
            parsed = new URL(baseUrl)
          } catch {
            throw new Error(`Invalid base URL format: "${baseUrl}". Must be a valid http:// or https:// URL.`)
          }

          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('URL must start with http:// or https://')
          }
        }
      }

      // 3. Validate API key if provided and required (skip for openai-compatible)
      if (apiKey && provider.requiresApiKey) {
        const validation = await client.requestWithAck<ProviderValidateApiKeyResponse>(
          ProviderEvents.VALIDATE_API_KEY,
          {apiKey, providerId},
        )
        if (!validation.isValid) {
          throw new Error(validation.error ?? 'The API key provided is invalid. Please check and try again.')
        }
      } else if (!apiKey && provider.requiresApiKey && !provider.isConnected) {
        throw new Error(
          `Provider "${providerId}" requires an API key. Use the --api-key flag to provide one.`
          + (provider.apiKeyUrl ? `\nDon't have one? Get your API key at: ${provider.apiKeyUrl}` : ''),
        )
      }

      // 4. Connect or switch active provider
      const hasNewConfig = apiKey || baseUrl
      await (provider.isConnected && !hasNewConfig
        ? client.requestWithAck<ProviderSetActiveResponse>(ProviderEvents.SET_ACTIVE, {providerId})
        : client.requestWithAck<ProviderConnectResponse>(ProviderEvents.CONNECT, {apiKey, baseUrl, providerId})
      );

      // 5. Set model if specified
      if (model) {
        await client.requestWithAck<ModelSetActiveResponse>(ModelEvents.SET_ACTIVE, {modelId: model, providerId})
      }

      return {model, providerId, providerName: provider.name}
    }, options)
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ProviderConnect)
    const providerId = args.provider
    const apiKey = flags['api-key']
    const baseUrl = flags['base-url']
    const {model} = flags
    const format = flags.format as 'json' | 'text'

    try {
      const result = await this.connectProvider({apiKey, baseUrl, model, providerId})

      if (format === 'json') {
        writeJsonResponse({command: 'provider connect', data: result, success: true})
      } else {
        this.log(`Connected to ${result.providerName} (${result.providerId})`)
        if (result.model) {
          this.log(`Model set to: ${result.model}`)
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred while connecting the provider. Please try again.'
      if (format === 'json') {
        writeJsonResponse({command: 'provider connect', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }
}
