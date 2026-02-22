import {Command, Flags} from '@oclif/core'

import {
  ProviderEvents,
  type ProviderGetActiveResponse,
  type ProviderListResponse,
} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class Model extends Command {
  public static description = 'Show the active model'
  public static examples = [
    '<%= config.bin %> model',
    '<%= config.bin %> model --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async fetchActiveModel(options?: DaemonClientOptions) {
    return withDaemonRetry(async (client) => {
      const active = await client.requestWithAck<ProviderGetActiveResponse>(ProviderEvents.GET_ACTIVE)
      const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)
      const provider = providers.find((p) => p.id === active.activeProviderId)

      return {
        activeModel: active.activeModel,
        providerId: active.activeProviderId,
        providerName: provider?.name ?? active.activeProviderId,
      }
    }, options)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Model)
    const format = flags.format as 'json' | 'text'

    try {
      const info = await this.fetchActiveModel()

      if (format === 'json') {
        writeJsonResponse({command: 'model', data: info, success: true})
      } else if (info.providerId === 'byterover') {
        this.log('You are using ByteRover provider, which runs on its own internal LLM model.')
      } else if (info.activeModel) {
        this.log(`Model: ${info.activeModel}`)
        this.log(`Provider: ${info.providerName} (${info.providerId})`)
      } else {
        this.log(`No model set for ${info.providerName} (${info.providerId}).`)
        this.log('Run "brv model list" to see available models, or "brv model switch <model>" to set one.')
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'model', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
