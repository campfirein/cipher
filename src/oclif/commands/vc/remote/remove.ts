import {Args, Command} from '@oclif/core'

import {type IVcRemoteResponse, VcEvents} from '../../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../../lib/daemon-client.js'

export default class VcRemoteRemove extends Command {
  public static args = {
    name: Args.string({description: 'Remote name', required: true}),
  }
  public static description = 'Remove a named remote'
  public static examples = [`<%= config.bin %> <%= command.id %> origin`]

  public async run(): Promise<void> {
    const {args} = await this.parse(VcRemoteRemove)

    if (args.name !== 'origin') {
      this.error(`Only 'origin' remote is currently supported.`)
    }

    try {
      await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcRemoteResponse>(VcEvents.REMOTE, {subcommand: 'remove'}),
      )
      this.log(`Remote 'origin' removed.`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
