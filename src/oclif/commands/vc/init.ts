import {Command} from '@oclif/core'

import {type IVcInitResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcInit extends Command {
  public static description = 'Initialize git repository in .brv/context-tree/'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const result = await withDaemonRetry(async (client) => client.requestWithAck<IVcInitResponse>(VcEvents.INIT, {}))

      if (result.reinitialized) {
        this.log(`Reinitialized existing Git repository in ${result.gitDir}`)
      } else {
        this.log(`Initialized Git repository in ${result.gitDir}`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
