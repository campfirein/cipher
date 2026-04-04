import {Command, Flags} from '@oclif/core'

import type {StatusGetResponse} from '../../../shared/transport/events/status-events.js'

import {StatusEvents} from '../../../shared/transport/events/status-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class SpaceList extends Command {
  public static description = 'List all teams and spaces (deprecated)'
  public static examples = ['<%= config.bin %> space list']
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
    const {flags} = await this.parse(SpaceList)
    const format = flags.format as 'json' | 'text'

    try {
      const {status} = await this.checkDeprecation()
      const isVc = status.contextTreeStatus === 'git_vc'

      const message = isVc
        ? 'The space list command has been deprecated. Visit the ByteRover web dashboard to view your spaces.'
        : 'The space list command has been deprecated. Visit the ByteRover web dashboard to view your spaces and follow the migration guide to version control.'

      if (format === 'json') {
        writeJsonResponse({command: 'space list', data: {message}, success: true})
      } else {
        this.log(message)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'space list', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
