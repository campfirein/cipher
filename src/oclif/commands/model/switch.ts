import {Args, Command, Flags} from '@oclif/core'

import {
  ModelEvents,
  type ModelSetActiveResponse,
} from '../../../shared/transport/events/model-events.js'
import {
  ProviderEvents,
  type ProviderGetActiveResponse,
  type ProviderListResponse,
} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ModelSwitch extends Command {
  public static args = {
    model: Args.string({
      description: 'Model ID to switch to (e.g., claude-sonnet-4-5, gpt-4.1)',
      required: true,
    }),
  }
  public static description = 'Switch the active model'
  public static examples = [
    '<%= config.bin %> model switch claude-sonnet-4-5',
    '<%= config.bin %> model switch gpt-4.1 --provider openai',
    '<%= config.bin %> model switch claude-sonnet-4-5 --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    provider: Flags.string({
      char: 'p',
      description: 'Provider ID (defaults to active provider)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ModelSwitch)
    const modelId = args.model
    const providerFlag = flags.provider
    const format = flags.format as 'json' | 'text'

    try {
      const result = await this.switchModel({modelId, providerFlag})

      if (format === 'json') {
        writeJsonResponse({command: 'model switch', data: result, success: true})
      } else {
        this.log(`Model switched to: ${result.modelId} (provider: ${result.providerId})`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred while switching the model. Please try again.'
      if (format === 'json') {
        writeJsonResponse({command: 'model switch', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }

  protected async switchModel(
    {modelId, providerFlag}: {modelId: string; providerFlag?: string},
    options?: DaemonClientOptions,
  ) {
    return withDaemonRetry(async (client) => {
      // 1. Resolve provider ID
      let providerId: string
      if (providerFlag) {
        const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)
        const provider = providers.find((p) => p.id === providerFlag)
        if (!provider) {
          throw new Error(`Unknown provider "${providerFlag}". Run "brv providers list" to see available providers.`)
        }

        if (!provider.isConnected) {
          throw new Error(`Provider "${providerFlag}" is not connected. Run "brv providers connect ${providerFlag}" first.`)
        }

        providerId = providerFlag
      } else {
        const active = await client.requestWithAck<ProviderGetActiveResponse>(ProviderEvents.GET_ACTIVE)
        providerId = active.activeProviderId
      }

      if (providerId === 'byterover') {
        throw new Error('ByteRover provider uses its own internal LLM and does not support model switching. Run "brv providers switch <provider>" to switch to a different provider first.')
      }

      // 2. Switch active model
      await client.requestWithAck<ModelSetActiveResponse>(ModelEvents.SET_ACTIVE, {modelId, providerId})

      return {modelId, providerId}
    }, options)
  }
}
