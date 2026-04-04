import {Args, Command, Flags} from '@oclif/core'

import {
  HubEvents,
  type HubUninstallRequest,
  type HubUninstallResponse,
} from '../../../shared/transport/events/hub-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class HubUninstall extends Command {
  public static args = {
    id: Args.string({
      description: 'ID of the bundle to uninstall',
      required: true,
    }),
  }
  public static description = 'Uninstall a bundle and remove it from dependencies'
  public static examples = ['<%= config.bin %> hub uninstall react-patterns']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(HubUninstall)
    const format = flags.format as 'json' | 'text'

    try {
      const result = await withDaemonRetry<HubUninstallResponse>(async (client) =>
        client.requestWithAck<HubUninstallResponse, HubUninstallRequest>(HubEvents.UNINSTALL, {entryId: args.id}),
      )

      if (format === 'json') {
        writeJsonResponse({command: 'hub uninstall', data: result, success: result.success})
      } else {
        this.log(result.message)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub uninstall', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
