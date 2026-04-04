import {Args, Command} from '@oclif/core'

import {
  HubEvents,
  type HubUninstallRequest,
  type HubUninstallResponse,
} from '../../../shared/transport/events/hub-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class HubUninstall extends Command {
  public static args = {
    id: Args.string({
      description: 'ID of the bundle to uninstall',
      required: true,
    }),
  }
  public static description = 'Uninstall a bundle and remove it from dependencies'
  public static examples = ['<%= config.bin %> hub uninstall react-patterns']

  public async run(): Promise<void> {
    const {args} = await this.parse(HubUninstall)

    try {
      const result = await withDaemonRetry<HubUninstallResponse>(async (client) =>
        client.requestWithAck<HubUninstallResponse, HubUninstallRequest>(HubEvents.UNINSTALL, {entryId: args.id}),
      )

      this.log(result.message)
    } catch (error) {
      this.log(formatConnectionError(error))
    }
  }
}
