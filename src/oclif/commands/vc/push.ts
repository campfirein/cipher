import {Command, Flags} from '@oclif/core'

import {type IVcPushResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPush extends Command {
  public static description = 'Push commits to ByteRover cloud'
  public static examples = ['<%= config.bin %> <%= command.id %>']
  public static flags = {
    branch: Flags.string({
      char: 'b',
      description: 'Branch to push to (default: current branch)',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(VcPush)

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcPushResponse>(VcEvents.PUSH, {branch: flags.branch}),
      )

      this.log(result.alreadyUpToDate ? 'Everything up-to-date.' : `Pushed to origin/${result.branch}.`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
