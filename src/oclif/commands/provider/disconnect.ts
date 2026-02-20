import {Args, Command, Flags} from '@oclif/core'

import {
  type ProviderDisconnectResponse,
  ProviderEvents,
  type ProviderListResponse,
} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ProviderDisconnect extends Command {
  public static args = {
    provider: Args.string({
      description: 'Provider ID to disconnect',
      required: true,
    }),
  }
  public static description = 'Disconnect an LLM provider'
  public static examples = [
    '<%= config.bin %> provider disconnect anthropic',
    '<%= config.bin %> provider disconnect openai --json',
  ]
  public static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  protected async disconnectProvider(providerId: string, options?: DaemonClientOptions) {
    return withDaemonRetry(async (client) => {
      // Verify provider exists and is connected
      const {providers} = await client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST)
      const provider = providers.find((p) => p.id === providerId)

      if (!provider) {
        throw new Error(`Unknown provider "${providerId}". Run "brv provider list" to see available providers.`)
      }

      if (!provider.isConnected) {
        throw new Error(`Provider "${providerId}" is not connected.`)
      }

      await client.requestWithAck<ProviderDisconnectResponse>(ProviderEvents.DISCONNECT, {providerId})
    }, options)
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ProviderDisconnect)
    const providerId = args.provider

    try {
      await this.disconnectProvider(providerId)

      if (flags.json) {
        writeJsonResponse({command: 'provider disconnect', data: {providerId}, success: true})
      } else {
        this.log(`Disconnected provider: ${providerId}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred while disconnecting the provider. Please try again.'
      if (flags.json) {
        writeJsonResponse({command: 'provider disconnect', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }
}
