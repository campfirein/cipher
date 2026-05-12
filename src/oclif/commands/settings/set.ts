import {Args, Command, Flags} from '@oclif/core'

import {
  SettingsEvents,
  type SettingsSetRequest,
  type SettingsSetResponse,
} from '../../../shared/transport/events/settings-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class SettingsSet extends Command {
  public static args = {
    key: Args.string({description: 'Settings key to write', required: true}),
    value: Args.string({description: 'New value for the key (integer)', required: true}),
  }
  public static description =
    'Update one settings value. Changes apply after `brv restart`.'
  public static examples = [
    '<%= config.bin %> settings set agentPool.maxSize 25',
    '<%= config.bin %> settings set agentPool.maxSize 25 --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(SettingsSet)
    const format = flags.format as 'json' | 'text'
    const value = parseValueForTransport(args.value)

    try {
      const response = await this.writeSetting(args.key, value)

      if (response.ok) {
        if (format === 'json') {
          writeJsonResponse({
            command: 'settings set',
            data: {restartRequired: response.restartRequired},
            success: true,
          })
        } else {
          this.log('Setting saved. Run `brv restart` to apply.')
        }

        return
      }

      process.exitCode = 1
      if (format === 'json') {
        writeJsonResponse({command: 'settings set', data: {error: response.error}, success: false})
      } else {
        this.log(response.error.message)
      }
    } catch (error) {
      process.exitCode = 1
      if (format === 'json') {
        writeJsonResponse({command: 'settings set', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }

  protected async writeSetting(
    key: string,
    value: unknown,
    options?: DaemonClientOptions,
  ): Promise<SettingsSetResponse> {
    return withDaemonRetry<SettingsSetResponse>(
      async (client) =>
        client.requestWithAck<SettingsSetResponse>(SettingsEvents.SET, {key, value} satisfies SettingsSetRequest),
      options,
    )
  }
}

function parseValueForTransport(raw: string): number | string {
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : raw
}
