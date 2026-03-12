import {Command, Flags} from '@oclif/core'

import {type IVcPullResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPull extends Command {
  public static description = 'Pull commits from ByteRover cloud'
  public static examples = ['<%= config.bin %> <%= command.id %>']
  public static flags = {
    branch: Flags.string({
      char: 'b',
      description: 'Branch to pull from (default: current branch)',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(VcPull)

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcPullResponse>(VcEvents.PULL, {branch: flags.branch}),
      )

      this.log(result.alreadyUpToDate ? 'Already up to date.' : `Pulled from origin/${result.branch}.`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
