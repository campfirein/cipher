import {Command} from '@oclif/core'

import {type IVcPullResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPull extends Command {
  public static description = 'Pull commits from ByteRover cloud'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const result = await withDaemonRetry(async (client) => client.requestWithAck<IVcPullResponse>(VcEvents.PULL))

      this.log(result.alreadyUpToDate ? 'Already up to date.' : `Pulled from origin/${result.branch}.`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
