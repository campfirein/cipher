import {Command, Flags} from '@oclif/core'

import {AuthEvents, type AuthLoginWithApiKeyResponse} from '../../shared/transport/events/auth-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'

export default class Login extends Command {
  public static description = 'Authenticate with ByteRover for cloud sync features (optional for local usage)'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --api-key <key>',
    '',
    '# JSON output (for automation)',
    '<%= config.bin %> <%= command.id %> --api-key <key> --format json',
  ]
  public static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'API key for authentication (get yours at https://app.byterover.dev/settings/keys)',
      required: true,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async loginWithApiKey(apiKey: string, options?: DaemonClientOptions): Promise<AuthLoginWithApiKeyResponse> {
    return withDaemonRetry<AuthLoginWithApiKeyResponse>(
      async (client) => client.requestWithAck<AuthLoginWithApiKeyResponse>(AuthEvents.LOGIN_WITH_API_KEY, {apiKey}),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Login)
    const apiKey = flags['api-key']
    const format = (flags.format ?? 'text') as 'json' | 'text'

    try {
      if (format === 'text') {
        this.log('Logging in...')
      }

      const response = await this.loginWithApiKey(apiKey)

      if (response.success) {
        if (format === 'json') {
          writeJsonResponse({command: 'login', data: {userEmail: response.userEmail}, success: true})
        } else {
          this.log(`Logged in as ${response.userEmail}`)
        }
      } else {
        const errorMessage = response.error ?? 'Authentication failed'
        if (format === 'json') {
          writeJsonResponse({command: 'login', data: {error: errorMessage}, success: false})
        } else {
          this.log(errorMessage)
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed'

      if (format === 'json') {
        writeJsonResponse({command: 'login', data: {error: errorMessage}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
