import {Args, Command, Flags} from '@oclif/core'

import {OAUTH_CALLBACK_TIMEOUT_MS} from '../../../shared/constants/oauth.js'
import {ModelEvents, type ModelSetActiveResponse} from '../../../shared/transport/events/model-events.js'
import {
  type ProviderAwaitOAuthCallbackResponse,
  type ProviderConnectResponse,
  ProviderEvents,
  type ProviderListResponse,
  type ProviderSetActiveResponse,
  type ProviderStartOAuthResponse,
  type ProviderSubmitOAuthCodeResponse,
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
    '<%= config.bin %> providers connect anthropic --api-key sk-xxx',
    '<%= config.bin %> providers connect openai --api-key sk-xxx --model gpt-4.1',
    '<%= config.bin %> providers connect openai --oauth',
    '<%= config.bin %> providers connect byterover',
    '<%= config.bin %> providers connect openai-compatible --base-url http://localhost:11434/v1',
    '<%= config.bin %> providers connect openai-compatible --base-url http://localhost:11434/v1 --api-key sk-xxx --model llama3',
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
    code: Flags.string({
      char: 'c',
      description:
        'Authorization code for code-paste OAuth providers (e.g., Anthropic). ' +
        'Not applicable to browser-callback providers like OpenAI — use --oauth without --code instead.',
      hidden: true,
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
    oauth: Flags.boolean({
      default: false,
      description: 'Connect via OAuth (browser-based)',
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
        throw new Error(`Unknown provider "${providerId}". Run "brv providers list" to see available providers.`)
      }

      // 2. Validate base URL for openai-compatible
      if (providerId === 'openai-compatible') {
        if (!baseUrl && !provider.isConnected) {
          throw new Error(
            'Provider "openai-compatible" requires a base URL. Use the --base-url flag to provide one.' +
              '\nExample: brv providers connect openai-compatible --base-url http://localhost:11434/v1',
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
          `Provider "${providerId}" requires an API key. Use the --api-key flag to provide one.` +
            (provider.apiKeyUrl ? `\nDon't have one? Get your API key at: ${provider.apiKeyUrl}` : ''),
        )
      }

      // 4. Connect or switch active provider
      const hasNewConfig = apiKey || baseUrl
      const response = await (provider.isConnected && !hasNewConfig
        ? client.requestWithAck<ProviderSetActiveResponse>(ProviderEvents.SET_ACTIVE, {providerId})
        : client.requestWithAck<ProviderConnectResponse>(ProviderEvents.CONNECT, {apiKey, baseUrl, providerId}))

      if (!response.success) {
        throw new Error(response.error ?? 'Failed to connect provider. Please try again.')
      }

      // 5. Set model if specified
      if (model) {
        await client.requestWithAck<ModelSetActiveResponse>(ModelEvents.SET_ACTIVE, {modelId: model, providerId})
      }

      return {model, providerId, providerName: provider.name}
    }, options)
  }

  protected async connectProviderOAuth(
    {code, providerId}: {code?: string; providerId: string},
    options?: DaemonClientOptions,
    onProgress?: (msg: string) => void,
  ) {
    return withDaemonRetry(async (client) => {
      // 1. Verify provider exists and supports OAuth
      const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        throw new Error(`Unknown provider "${providerId}". Run "brv providers list" to see available providers.`)
      }

      if (!provider.supportsOAuth) {
        throw new Error(`Provider "${providerId}" does not support OAuth. Use --api-key instead.`)
      }

      // --code is only valid for code-paste providers (e.g., Anthropic).
      // Browser-callback providers like OpenAI handle the code exchange automatically.
      if (code && provider.oauthCallbackMode !== 'code-paste') {
        throw new Error(
          `Provider "${providerId}" uses browser-based OAuth and does not accept --code.\n` +
            `Run: brv providers connect ${providerId} --oauth`,
        )
      }

      // If --code is provided, submit it directly (code-paste providers)
      if (code) {
        const response = await client.requestWithAck<ProviderSubmitOAuthCodeResponse>(
          ProviderEvents.SUBMIT_OAUTH_CODE,
          {code, providerId},
        )
        if (!response.success) {
          throw new Error(response.error ?? 'OAuth code submission failed')
        }

        return {providerName: provider.name, showInstructions: false}
      }

      // 2. Start OAuth flow — returns immediately with auth URL
      const startResponse = await client.requestWithAck<ProviderStartOAuthResponse>(ProviderEvents.START_OAUTH, {
        providerId,
      })
      if (!startResponse.success) {
        throw new Error(startResponse.error ?? 'Failed to start OAuth flow')
      }

      // Always print auth URL (user's machine may not support browser launch)
      onProgress?.(`\nOpen this URL to authenticate:\n  ${startResponse.authUrl}\n`)

      // 3. Handle based on callback mode
      if (startResponse.callbackMode === 'auto') {
        onProgress?.('Waiting for authentication in browser...')
        const awaitResponse = await client.requestWithAck<ProviderAwaitOAuthCallbackResponse>(
          ProviderEvents.AWAIT_OAUTH_CALLBACK,
          {providerId},
          {timeout: OAUTH_CALLBACK_TIMEOUT_MS},
        )
        if (!awaitResponse.success) {
          throw new Error(awaitResponse.error ?? 'OAuth authentication failed')
        }

        return {providerName: provider.name, showInstructions: false}
      }

      // code-paste mode: print instructions and exit
      onProgress?.('Copy the authorization code from the browser and run:')
      onProgress?.(`  brv providers connect ${providerId} --oauth --code <code>`)
      return {providerName: provider.name, showInstructions: true}
    }, options)
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ProviderConnect)
    const providerId = args.provider
    const apiKey = flags['api-key']
    const baseUrl = flags['base-url']
    const {code, model, oauth} = flags
    const format: 'json' | 'text' = flags.format === 'json' ? 'json' : 'text'

    // Validate flag combinations
    if (oauth && apiKey) {
      const msg = 'Cannot use --oauth and --api-key together'
      if (format === 'json') {
        writeJsonResponse({command: 'providers connect', data: {error: msg}, success: false})
      } else {
        this.log(msg)
      }

      return
    }

    if (code && !oauth) {
      const msg = '--code requires the --oauth flag'
      if (format === 'json') {
        writeJsonResponse({command: 'providers connect', data: {error: msg}, success: false})
      } else {
        this.log(msg)
      }

      return
    }

    try {
      if (oauth) {
        const onProgress = format === 'text' ? (msg: string) => this.log(msg) : undefined
        const result = await this.connectProviderOAuth({code, providerId}, undefined, onProgress)

        if (format === 'json') {
          writeJsonResponse({command: 'providers connect', data: {providerId}, success: true})
        } else if (!result.showInstructions) {
          this.log(`Connected to ${result.providerName} via OAuth`)
        }
      } else {
        const result = await this.connectProvider({apiKey, baseUrl, model, providerId})

        if (format === 'json') {
          writeJsonResponse({command: 'providers connect', data: result, success: true})
        } else {
          this.log(`Connected to ${result.providerName} (${result.providerId})`)
          if (result.model) {
            this.log(`Model set to: ${result.model}`)
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred while connecting the provider. Please try again.'
      if (format === 'json') {
        writeJsonResponse({command: 'providers connect', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }
}
