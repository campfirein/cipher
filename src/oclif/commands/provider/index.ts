import {Command, Flags} from '@oclif/core'

import {
  ProviderEvents,
  type ProviderGetActiveResponse,
  type ProviderListResponse,
} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class Provider extends Command {
  public static description = 'Show active provider and model'
  public static examples = [
    '<%= config.bin %> provider',
    '<%= config.bin %> provider --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async fetchActiveProvider(options?: DaemonClientOptions) {
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
    const {flags} = await this.parse(Provider)
    const format = flags.format as 'json' | 'text'

    try {
      const info = await this.fetchActiveProvider()

      if (format === 'json') {
        writeJsonResponse({command: 'provider', data: info, success: true})
      } else {
        this.log(`Provider: ${info.providerName} (${info.providerId})`)
        if (info.providerId !== 'byterover') {
          if (info.activeModel) {
            this.log(`Model: ${info.activeModel}`)
          } else {
            this.log('Model: Not set. Run "brv model list" to see available models, or "brv model switch <model>" to set one.')
          }
        }
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'provider', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
