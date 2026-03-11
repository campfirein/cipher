import {Args, Command} from '@oclif/core'

import {type IVcRemoteResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcRemote extends Command {
  public static args = {
    subcommand: Args.string({description: 'Subcommand: add | set-url (omit to show current remote)'}),
    url: Args.string({description: 'Remote URL (e.g. https://user:token@host/repo.git)'}),
  }
  public static description = 'Manage remote origin for ByteRover version control'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> add https://user:token@host/repo.git',
    '<%= config.bin %> <%= command.id %> set-url https://user:token@host/repo.git',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(VcRemote)
    const {subcommand, url} = args

    if (!subcommand) {
      // show current remote
      try {
        const result = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcRemoteResponse>(VcEvents.REMOTE, {subcommand: 'show'}),
        )
        this.log(result.url ? `origin: ${result.url}` : 'No remote configured.')
      } catch (error) {
        this.error(formatConnectionError(error))
      }

      return
    }

    if (subcommand !== 'add' && subcommand !== 'set-url') {
      this.error(`Unknown subcommand '${subcommand}'. Usage: brv vc remote [add|set-url] <url>`)
    }

    if (!url) {
      this.error(`Usage: brv vc remote ${subcommand} <url>`)
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcRemoteResponse>(VcEvents.REMOTE, {subcommand, url}),
      )

      if (result.action === 'add') {
        this.log(`Remote 'origin' set to ${result.url}.`)
      } else {
        this.log(`Remote 'origin' updated to ${result.url}.`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
