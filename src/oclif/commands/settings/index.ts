import {Command, Flags} from '@oclif/core'

import {
  SettingsEvents,
  type SettingsListResponse,
} from '../../../shared/transport/events/settings-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

const HEADER = ['KEY', 'CURRENT', 'DEFAULT', 'RESTART?']

export default class Settings extends Command {
  public static description =
    'List user-configurable BRV settings. Changes apply after `brv restart`.'
  public static examples = ['<%= config.bin %> settings', '<%= config.bin %> settings --format json']
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async fetchSettings(options?: DaemonClientOptions): Promise<SettingsListResponse> {
    return withDaemonRetry<SettingsListResponse>(
      async (client) => client.requestWithAck<SettingsListResponse>(SettingsEvents.LIST),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Settings)
    const format = flags.format as 'json' | 'text'

    try {
      const response = await this.fetchSettings()

      if (format === 'json') {
        writeJsonResponse({command: 'settings', data: {items: response.items}, success: true})
        return
      }

      this.printTable(response)
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'settings', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  private printTable(response: SettingsListResponse): void {
    if (response.items.length === 0) {
      this.log('No settings registered.')
      return
    }

    const widths = [
      Math.max(HEADER[0].length, ...response.items.map((i) => i.key.length)),
      Math.max(HEADER[1].length, ...response.items.map((i) => String(i.current).length)),
      Math.max(HEADER[2].length, ...response.items.map((i) => String(i.default).length)),
      HEADER[3].length,
    ]

    this.log(pad(HEADER[0], widths[0]) + '  ' + pad(HEADER[1], widths[1]) + '  ' + pad(HEADER[2], widths[2]) + '  ' + HEADER[3])
    for (const item of response.items) {
      this.log(
        pad(item.key, widths[0]) +
          '  ' +
          pad(String(item.current), widths[1]) +
          '  ' +
          pad(String(item.default), widths[2]) +
          '  ' +
          (item.restartRequired ? 'yes' : 'no'),
      )
    }
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}
