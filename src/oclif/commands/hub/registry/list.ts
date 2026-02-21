import {Command, Flags} from '@oclif/core'

import {HubEvents, type HubRegistryListResponse} from '../../../../shared/transport/events/hub-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../../lib/daemon-client.js'
import {writeJsonResponse} from '../../../lib/json-response.js'

export default class HubRegistryList extends Command {
  public static description = 'List configured hub registries'
  public static examples = [
    '<%= config.bin %> hub registry list',
    '<%= config.bin %> hub registry list --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async fetchRegistries(options?: DaemonClientOptions): Promise<HubRegistryListResponse> {
    return withDaemonRetry<HubRegistryListResponse>(
      async (client) => client.requestWithAck<HubRegistryListResponse>(HubEvents.REGISTRY_LIST),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(HubRegistryList)
    const format = flags.format as 'json' | 'text'

    try {
      const data = await this.fetchRegistries()

      if (format === 'json') {
        writeJsonResponse({command: 'hub registry list', data, success: true})
      } else {
        this.log(`Registries (${data.registries.length}):\n`)
        for (const r of data.registries) {
          const scheme = r.authScheme && r.authScheme !== 'none' && r.authScheme !== 'bearer' ? ` [${r.authScheme}]` : ''
          const tokenLabel = r.hasToken ? ' (authenticated)' : ''
          const statusLabel = r.status === 'ok' ? `${r.entryCount} entries` : `error: ${r.error}`
          this.log(`  ${r.name} - ${r.url}${scheme}${tokenLabel} (${statusLabel})`)
        }
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub registry list', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
