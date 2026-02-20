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

export default class ModelSet extends Command {
  public static args = {
    model: Args.string({
      description: 'Model ID to set as active (e.g., claude-sonnet-4-5, gpt-4.1)',
      required: true,
    }),
  }
  public static description = 'Set the active model'
  public static examples = [
    '<%= config.bin %> model set claude-sonnet-4-5',
    '<%= config.bin %> model set gpt-4.1 --provider openai',
    '<%= config.bin %> model set claude-sonnet-4-5 --json',
  ]
  public static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    provider: Flags.string({
      char: 'p',
      description: 'Provider ID (defaults to active provider)',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ModelSet)
    const modelId = args.model
    const providerFlag = flags.provider

    try {
      const result = await this.setActiveModel({modelId, providerFlag})

      if (flags.json) {
        writeJsonResponse({command: 'model set', data: result, success: true})
      } else {
        this.log(`Model set to: ${result.modelId} (provider: ${result.providerId})`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred while setting the model. Please try again.'
      if (flags.json) {
        writeJsonResponse({command: 'model set', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }

  protected async setActiveModel(
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
          throw new Error(`Unknown provider "${providerFlag}". Run "brv provider list" to see available providers.`)
        }

        if (!provider.isConnected) {
          throw new Error(`Provider "${providerFlag}" is not connected. Run "brv provider connect ${providerFlag}" first.`)
        }

        providerId = providerFlag
      } else {
        const active = await client.requestWithAck<ProviderGetActiveResponse>(ProviderEvents.GET_ACTIVE)
        providerId = active.activeProviderId
      }

      // 2. Set active model
      await client.requestWithAck<ModelSetActiveResponse>(ModelEvents.SET_ACTIVE, {modelId, providerId})

      return {modelId, providerId}
    }, options)
  }
}
