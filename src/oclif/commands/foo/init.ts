import {Command, Flags} from '@oclif/core'

import {FooEvents, type FooInitResponse} from '../../../shared/transport/events/foo-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class FooInit extends Command {
  public static description = 'Initialize git repository in .brv/context-tree/ (internal demo)'
  public static examples = ['<%= config.bin %> <%= command.id %> --team my-team --space my-space']
  public static flags = {
    space: Flags.string({description: 'Space ID', required: true}),
    team: Flags.string({description: 'Team ID', required: true}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(FooInit)

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<FooInitResponse>(FooEvents.INIT, {
          spaceId: flags.space,
          teamId: flags.team,
        }),
      )

      this.log('Git repository initialized in .brv/context-tree/')
      this.log(`Remote 'origin' → ${result.remoteUrl}`)
    } catch (error) {
      this.log(formatConnectionError(error))
    }
  }
}
