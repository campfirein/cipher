import {Args, Command} from '@oclif/core'

import {getGitRemoteBaseUrl} from '../../../../server/config/environment.js'
import {type IVcRemoteResponse, VcEvents} from '../../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../../lib/daemon-client.js'

export default class VcRemoteAdd extends Command {
  public static args = {
    name: Args.string({description: 'Remote name', required: true}),
    url: Args.string({
      description: `Remote URL (e.g. ${getGitRemoteBaseUrl()}/<team>/<space>.git)`,
      required: true,
    }),
  }
  public static description = 'Add a named remote'
  public static examples = [
    `<%= config.bin %> <%= command.id %> origin ${getGitRemoteBaseUrl()}/acme/project.git`,
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(VcRemoteAdd)

    if (args.name !== 'origin') {
      this.error(`Only 'origin' remote is currently supported.`)
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcRemoteResponse>(VcEvents.REMOTE, {subcommand: 'add', url: args.url}),
      )
      this.log(`Remote 'origin' set to ${result.url}.`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
