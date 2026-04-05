import {Command} from '@oclif/core'

import {type IVcRemoteResponse, VcEvents} from '../../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../../lib/daemon-client.js'

export default class VcRemote extends Command {
  public static description = 'Show current remote origin'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcRemoteResponse>(VcEvents.REMOTE, {subcommand: 'show'}),
      )
      this.log(result.url ? `origin: ${result.url}` : 'No remote configured.')
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
