import {Command, Flags} from '@oclif/core'

import {AuthEvents, type AuthLogoutResponse} from '../../shared/transport/events/auth-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'

export default class Logout extends Command {
  public static description = 'Disconnect from ByteRover cloud and clear stored credentials'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '',
    '# JSON output (for automation)',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async performLogout(options?: DaemonClientOptions): Promise<AuthLogoutResponse> {
    return withDaemonRetry<AuthLogoutResponse>(
      async (client) => client.requestWithAck<AuthLogoutResponse>(AuthEvents.LOGOUT),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Logout)
    const format = flags.format ?? 'text'

    try {
      if (format === 'text') {
        this.log('Logging out...')
      }

      const response = await this.performLogout()

      if (response.success) {
        if (format === 'json') {
          writeJsonResponse({command: 'logout', data: {}, success: true})
        } else {
          this.log('Logged out successfully')
        }
      } else {
        const errorMessage = response.error ?? 'Logout failed'
        if (format === 'json') {
          writeJsonResponse({command: 'logout', data: {error: errorMessage}, success: false})
        } else {
          this.log(errorMessage)
        }

      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Logout failed'

      if (format === 'json') {
        writeJsonResponse({command: 'logout', data: {error: errorMessage}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }

    }
  }
}
