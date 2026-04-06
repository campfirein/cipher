import {Command} from '@oclif/core'

import {InitEvents, type InitLocalResponse} from '../../../shared/transport/events/init-events.js'
import {type IVcInitResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcInit extends Command {
  public static description = 'Initialize ByteRover version control for context tree'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    const daemonOptions = {projectPath: process.cwd()}

    try {
      // Ensure .brv/config.json exists so the daemon can register this project
      await withDaemonRetry(
        async (client) => client.requestWithAck<InitLocalResponse>(InitEvents.LOCAL, {}),
        daemonOptions,
      )

      const result = await withDaemonRetry(
        async (client) => client.requestWithAck<IVcInitResponse>(VcEvents.INIT, {}),
        daemonOptions,
      )

      if (result.reinitialized) {
        this.log(`Reinitialized existing ByteRover version control in ${result.gitDir}`)
      } else {
        this.log(`Initialized ByteRover version control in ${result.gitDir}`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
