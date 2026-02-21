import {Command, Flags} from '@oclif/core'

import type {HubEntryDTO} from '../../../shared/transport/types/dto.js'

import {HubEvents, type HubListResponse} from '../../../shared/transport/events/hub-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class HubList extends Command {
  public static description = 'List available skills & bundles from the hub'
  public static examples = ['<%= config.bin %> hub list', '<%= config.bin %> hub list --format json']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async fetchList(options?: DaemonClientOptions): Promise<HubListResponse> {
    return withDaemonRetry<HubListResponse>(
      async (client) => client.requestWithAck<HubListResponse>(HubEvents.LIST),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(HubList)
    const format = flags.format as 'json' | 'text'

    try {
      const data = await this.fetchList()

      if (format === 'json') {
        const outputData = {
          entries: data.entries.map((entry) => ({
            id: entry.id,
            registry: entry.registry,
            type: entry.type,
            version: entry.version,
            description: entry.description, // eslint-disable-line perfectionist/sort-objects
            category: entry.category, // eslint-disable-line perfectionist/sort-objects
          })),
          version: data.version,
        }

        writeJsonResponse({command: 'hub list', data: outputData, success: true})
      } else {
        this.log(`BRV Hub (v${data.version}) - ${data.entries.length} entries\n`)
        this.log('| ID | Type | Version | Description | Category |')
        this.log('| --- | --- | --- | --- | --- |')

        // Only show registry name if entries come from more than one registry
        const registryNames = new Set(data.entries.map((e) => e.registry))
        const showRegistry = registryNames.size > 1
        for (const entry of data.entries) {
          this.log(this.formatEntry(entry, showRegistry))
        }

        this.log(`\nInstall: brv hub install <id> [--registry <name>]`)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub list', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  private formatEntry(entry: HubEntryDTO, showRegistry: boolean): string {
    const type = entry.type === 'agent-skill' ? 'skill' : 'bundle'
    const registry = showRegistry && entry.registry ? ` (${entry.registry})` : ''
    return `| ${entry.id}${registry} | ${type} | v${entry.version} | ${entry.description} | ${entry.category} |`
  }
}
