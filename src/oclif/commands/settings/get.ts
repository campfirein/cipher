import {Args, Command, Flags} from '@oclif/core'

import {
  SettingsEvents,
  type SettingsGetRequest,
  type SettingsGetResponse,
} from '../../../shared/transport/events/settings-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class SettingsGet extends Command {
  public static args = {
    key: Args.string({description: 'Settings key to read', required: true}),
  }
  public static description =
    'Read one settings value. Changes apply after `brv restart`.'
  public static examples = [
    '<%= config.bin %> settings get agentPool.maxSize',
    '<%= config.bin %> settings get agentPool.maxSize --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async fetchSetting(key: string, options?: DaemonClientOptions): Promise<SettingsGetResponse> {
    return withDaemonRetry<SettingsGetResponse>(
      async (client) =>
        client.requestWithAck<SettingsGetResponse>(SettingsEvents.GET, {key} satisfies SettingsGetRequest),
      options,
    )
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(SettingsGet)
    const format = flags.format as 'json' | 'text'

    try {
      const response = await this.fetchSetting(args.key)

      if (response.ok) {
        if (format === 'json') {
          writeJsonResponse({
            command: 'settings get',
            data: {
              current: response.current,
              default: response.default,
              description: response.description,
              key: response.key,
              max: response.max,
              min: response.min,
              restartRequired: response.restartRequired,
              type: response.type,
            },
            success: true,
          })
        } else {
          this.log(`${response.current}  (default: ${response.default})`)
        }

        return
      }

      process.exitCode = 1
      if (format === 'json') {
        writeJsonResponse({command: 'settings get', data: {error: response.error}, success: false})
      } else {
        this.log(response.error.message)
      }
    } catch (error) {
      process.exitCode = 1
      if (format === 'json') {
        writeJsonResponse({command: 'settings get', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
