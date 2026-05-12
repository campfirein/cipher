import {Args, Command, Flags} from '@oclif/core'

import {
  SettingsEvents,
  type SettingsResetRequest,
  type SettingsResetResponse,
} from '../../../shared/transport/events/settings-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class SettingsReset extends Command {
  public static args = {
    key: Args.string({description: 'Settings key to reset', required: true}),
  }
  public static description =
    'Restore one settings value to its default. Changes apply after `brv restart`.'
  public static examples = [
    '<%= config.bin %> settings reset agentPool.maxSize',
    '<%= config.bin %> settings reset agentPool.maxSize --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async resetSetting(key: string, options?: DaemonClientOptions): Promise<SettingsResetResponse> {
    return withDaemonRetry<SettingsResetResponse>(
      async (client) =>
        client.requestWithAck<SettingsResetResponse>(SettingsEvents.RESET, {key} satisfies SettingsResetRequest),
      options,
    )
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(SettingsReset)
    const format = flags.format as 'json' | 'text'

    try {
      const response = await this.resetSetting(args.key)

      if (response.ok) {
        if (format === 'json') {
          writeJsonResponse({
            command: 'settings reset',
            data: {restartRequired: response.restartRequired},
            success: true,
          })
        } else {
          this.log('Setting reset. Run `brv restart` to apply.')
        }

        return
      }

      process.exitCode = 1
      if (format === 'json') {
        writeJsonResponse({command: 'settings reset', data: {error: response.error}, success: false})
      } else {
        this.log(response.error.message)
      }
    } catch (error) {
      process.exitCode = 1
      if (format === 'json') {
        writeJsonResponse({command: 'settings reset', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
