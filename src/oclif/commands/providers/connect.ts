import {input, password, select, Separator} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'

import type {ProviderDTO} from '../../../shared/transport/types/dto.js'

import {OAUTH_CALLBACK_TIMEOUT_MS} from '../../../shared/constants/oauth.js'
import {
  ModelEvents,
  type ModelListRequest,
  type ModelListResponse,
  type ModelSetActiveResponse,
} from '../../../shared/transport/events/model-events.js'
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
import {createEscapeSignal, ESC_HINT, isPromptCancelled} from '../../lib/prompt-utils.js'

export default class ProviderConnect extends Command {
  public static args = {
    provider: Args.string({
      description: 'Provider ID to connect (e.g., anthropic, openai, openrouter). Omit for interactive selection.',
      required: false,
    }),
  }
  public static description = 'Connect or switch to an LLM provider'
  public static examples = [
    '<%= config.bin %> providers connect',
    '<%= config.bin %> providers connect anthropic --api-key sk-xxx',
    '<%= config.bin %> providers connect openai --oauth',
    '<%= config.bin %> providers connect byterover',
    '<%= config.bin %> providers connect openai-compatible --base-url http://localhost:11434/v1 --api-key sk-xxx',
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
      await (provider.isConnected && !hasNewConfig
        ? client.requestWithAck<ProviderSetActiveResponse>(ProviderEvents.SET_ACTIVE, {providerId})
        : client.requestWithAck<ProviderConnectResponse>(ProviderEvents.CONNECT, {apiKey, baseUrl, providerId}))

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
      const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        throw new Error(`Unknown provider "${providerId}". Run "brv providers list" to see available providers.`)
      }

      if (!provider.supportsOAuth) {
        throw new Error(`Provider "${providerId}" does not support OAuth. Use --api-key instead.`)
      }

      if (code && provider.oauthCallbackMode !== 'code-paste') {
        throw new Error(
          `Provider "${providerId}" uses browser-based OAuth and does not accept --code.\n` +
            `Run: brv providers connect ${providerId} --oauth`,
        )
      }

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

      const startResponse = await client.requestWithAck<ProviderStartOAuthResponse>(ProviderEvents.START_OAUTH, {
        providerId,
      })
      if (!startResponse.success) {
        throw new Error(startResponse.error ?? 'Failed to start OAuth flow')
      }

      onProgress?.(`\nOpen this URL to authenticate:\n  ${startResponse.authUrl}\n`)

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

      onProgress?.('Copy the authorization code from the browser and run:')
      onProgress?.(`  brv providers connect ${providerId} --oauth --code <code>`)
      return {providerName: provider.name, showInstructions: true}
    }, options)
  }

  protected async fetchModels(providerId: string, options?: DaemonClientOptions): Promise<ModelListResponse> {
    return withDaemonRetry(
      async (client) =>
        client.requestWithAck<ModelListResponse>(ModelEvents.LIST, {providerId} satisfies ModelListRequest),
      options,
    )
  }

  protected async promptForApiKey(providerName: string, apiKeyUrl?: string, signal?: AbortSignal): Promise<string> {
    const hint = apiKeyUrl ? ` (get one at ${apiKeyUrl})` : ''
    return password({message: `Enter API key for ${providerName}${hint}: ${ESC_HINT}`}, {signal})
  }

  protected async promptForBaseUrl(signal?: AbortSignal): Promise<string> {
    return input({message: `Enter base URL (e.g., http://localhost:11434/v1): ${ESC_HINT}`}, {signal})
  }

  protected async promptForModel(
    models: {id: string; name: string}[],
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    // Add a blank line before the prompt
    this.log()

    return select(
      {
        choices: [{name: 'Skip (use default)', value: ''}, ...models.map((m) => ({name: m.name, value: m.id}))],
        loop: false,
        message: `Select a model ${ESC_HINT}`,
      },
      {signal},
    ).then((v) => v || undefined)
  }

  protected async promptForProvider(providers: ProviderDTO[], signal?: AbortSignal): Promise<string> {
    const nameMaxChars = Math.max(...providers.map((p) => p.name.length))
    const popular = providers.filter((p) => p.category === 'popular')
    const other = providers.filter((p) => p.category === 'other')

    const formatChoice = (p: ProviderDTO) => ({
      name: `${p.name.padEnd(nameMaxChars + 3)} ${p.description}`,
      value: p.id,
    })

    // Add a blank line before the prompt
    this.log()

    return select(
      {
        choices: [
          new Separator('---------- Popular ----------'),
          ...popular.map((p) => formatChoice(p)),
          new Separator('\n---------- Others ----------'),
          ...other.map((p) => formatChoice(p)),
        ],
        loop: false,
        message: 'Select a provider',
      },
      {signal},
    )
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ProviderConnect)
    const providerId = args.provider
    const format: 'json' | 'text' = flags.format === 'json' ? 'json' : 'text'

    // Interactive mode: no provider arg
    if (!providerId) {
      if (format === 'json') {
        writeJsonResponse({
          command: 'providers connect',
          data: {error: 'Provider argument is required for JSON output'},
          success: false,
        })
        return
      }

      try {
        await this.runInteractive()
      } catch (error) {
        this.log(
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred while connecting the provider. Please try again.',
        )
      }

      return
    }

    // Non-interactive mode: provider arg provided
    await this.runNonInteractive(providerId, flags, format)
  }

  /**
   * Interactive flow with cancel-to-go-back navigation.
   * Step 1 (provider) ← Step 2 (auth) ← Step 3 (model)
   */
  protected async runInteractive(): Promise<void> {
    const {providers} = await withDaemonRetry(async (client) =>
      client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST),
    )

    const esc = createEscapeSignal()
    const STEPS = ['provider', 'auth', 'model'] as const
    let stepIndex = 0
    let providerId: string | undefined
    let provider: ProviderDTO | undefined

    try {
      /* eslint-disable no-await-in-loop -- intentional sequential interactive wizard */
      while (stepIndex < STEPS.length) {
        const currentStep = STEPS[stepIndex]
        try {
          switch (currentStep) {
            case 'auth': {
              // If providerId or provider is not set, go back to provider step
              // eslint-disable-next-line max-depth
              if (!providerId || !provider) {
                stepIndex--
                break
              }

              await this.runAuthStep(providerId, provider, esc.signal)
              break
            }

            case 'model': {
              // If providerId is not set, go back to provider step
              // eslint-disable-next-line max-depth
              if (!providerId) {
                stepIndex = 0
                break
              }

              await this.runModelStep(providerId, esc.signal)
              break
            }

            case 'provider': {
              providerId = await this.promptForProvider(providers, esc.signal)
              provider = providers.find((p) => p.id === providerId)
              break
            }
          }

          stepIndex++
        } catch (error) {
          if (isPromptCancelled(error)) {
            if (stepIndex === 0) return // cancel on first step → exit
            esc.reset()
            stepIndex--
          } else {
            throw error
          }
        }
      }
      /* eslint-enable no-await-in-loop */
    } finally {
      esc.cleanup()
    }
  }

  protected async runNonInteractive(
    providerId: string,
    flags: {[key: string]: unknown},
    format: 'json' | 'text',
  ): Promise<void> {
    const apiKey = flags['api-key'] as string | undefined
    const baseUrl = flags['base-url'] as string | undefined
    const code = flags.code as string | undefined
    const model = flags.model as string | undefined
    const oauth = flags.oauth as boolean

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

  private async runAuthStep(providerId: string, provider: ProviderDTO, signal?: AbortSignal): Promise<void> {
    let apiKey: string | undefined
    let baseUrl: string | undefined

    if (providerId === 'openai-compatible' && !provider.isConnected) {
      baseUrl = await this.promptForBaseUrl(signal)
    }

    if (provider.requiresApiKey && !provider.isConnected) {
      apiKey = await this.promptForApiKey(provider.name, provider.apiKeyUrl, signal)
    }

    const result = await this.connectProvider({apiKey, baseUrl, providerId})
    this.log(`Connected to ${result.providerName} (${result.providerId})`)
  }

  private async runModelStep(providerId: string, signal?: AbortSignal): Promise<void> {
    const modelList = await this.fetchModels(providerId)
    if (modelList.models.length === 0) return

    const modelId = await this.promptForModel(modelList.models, signal)
    if (!modelId) return

    await withDaemonRetry(async (client) =>
      client.requestWithAck<ModelSetActiveResponse>(ModelEvents.SET_ACTIVE, {modelId, providerId}),
    )
    this.log(`Model set to: ${modelId}`)
  }
}
