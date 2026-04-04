import {Command, Flags} from '@oclif/core'

import type {StatusGetResponse} from '../../../shared/transport/events/status-events.js'

import {StatusEvents} from '../../../shared/transport/events/status-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class SpaceSwitch extends Command {
  public static description = 'Switch to a different space (deprecated)'
  public static examples = ['<%= config.bin %> space switch']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async checkDeprecation(options?: DaemonClientOptions): Promise<StatusGetResponse> {
    return withDaemonRetry<StatusGetResponse>(
      async (client) => client.requestWithAck<StatusGetResponse>(StatusEvents.GET),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SpaceSwitch)
    const format = flags.format as 'json' | 'text'

    try {
      const {status} = await this.checkDeprecation()
      const isVc = status.contextTreeStatus === 'git_vc'

      const message = isVc
        ? 'The space switch command has been deprecated. To work with a different space, use: brv vc clone <url>'
        : 'The space switch command has been deprecated. Visit the ByteRover web dashboard to follow the migration guide from snapshot to version control.'

      if (format === 'json') {
        writeJsonResponse({command: 'space switch', data: {message}, success: true})
      } else {
        this.log(message)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'space switch', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
