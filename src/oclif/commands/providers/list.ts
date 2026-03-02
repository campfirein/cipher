import {Command, Flags} from '@oclif/core'
import chalk from 'chalk'

import {ProviderEvents, type ProviderListResponse} from '../../../shared/transport/events/provider-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ProviderList extends Command {
  public static description = 'List all available providers and their connection status'
  public static examples = [
    '<%= config.bin %> providers list',
    '<%= config.bin %> providers list --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async fetchProviders(options?: DaemonClientOptions) {
    return withDaemonRetry<ProviderListResponse>(
      async (client) => client.requestWithAck<ProviderListResponse>(ProviderEvents.LIST),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(ProviderList)
    const format = flags.format as 'json' | 'text'

    try {
      const {providers} = await this.fetchProviders()

      if (format === 'json') {
        writeJsonResponse({command: 'providers list', data: {providers}, success: true})
        return
      }

      for (const p of providers) {
        const status = p.isCurrent ? chalk.green('(current)') : p.isConnected ? chalk.yellow('(connected)') : ''
        this.log(`  ${p.name} [${p.id}] ${status}`.trimEnd())
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'providers list', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
