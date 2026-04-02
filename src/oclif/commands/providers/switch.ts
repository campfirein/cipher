import {Args, Command, Flags} from '@oclif/core'

import {
  ProviderEvents,
  type ProviderListResponse,
  type ProviderSetActiveResponse,
} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ProviderSwitch extends Command {
  public static args = {
    provider: Args.string({
      description: 'Provider ID to switch to (e.g., anthropic, openai)',
      required: true,
    }),
  }
  public static description = 'Switch the active provider'
  public static examples = [
    '<%= config.bin %> providers switch anthropic',
    '<%= config.bin %> providers switch openai --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ProviderSwitch)
    const providerId = args.provider
    const format = flags.format as 'json' | 'text'

    try {
      const result = await this.switchProvider(providerId)

      if (format === 'json') {
        writeJsonResponse({command: 'providers switch', data: result, success: true})
      } else {
        this.log(`Switched to ${result.providerName} (${result.providerId})`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred while switching the provider. Please try again.'
      if (format === 'json') {
        writeJsonResponse({command: 'providers switch', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }

  protected async switchProvider(providerId: string, options?: DaemonClientOptions) {
    return withDaemonRetry(async (client) => {
      const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)
      const provider = providers.find((p) => p.id === providerId)

      if (!provider) {
        throw new Error(`Unknown provider "${providerId}". Run "brv providers list" to see available providers.`)
      }

      if (!provider.isConnected) {
        throw new Error(`Provider "${providerId}" is not connected. Use "brv providers connect ${providerId}" instead.`)
      }

      const response = await client.requestWithAck<ProviderSetActiveResponse>(ProviderEvents.SET_ACTIVE, {providerId})

      if (!response.success) {
        throw new Error(response.error ?? 'Failed to switch provider. Please try again.')
      }

      return {providerId, providerName: provider.name}
    }, options)
  }
}
