import {Command, Flags} from '@oclif/core'

import {type IVcPushResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPush extends Command {
  public static description = 'Push commits to ByteRover cloud'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> -u',
    '<%= config.bin %> <%= command.id %> origin feat/my-branch',
  ]
  public static flags = {
    'set-upstream': Flags.boolean({
      char: 'u',
      default: false,
      description: 'Set upstream tracking branch',
    }),
  }
  public static strict = false

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(VcPush)
    const positional = argv as string[]

    // Git push semantics: push [<remote> [<branch>]]
    //   brv vc push                → current branch
    //   brv vc push origin         → current branch (explicit remote)
    //   brv vc push origin feat/x  → feat/x
    //   brv vc push feat/x         → error (unknown remote)
    let branch: string | undefined
    if (positional.length >= 2) {
      if (positional[0] !== 'origin') {
        this.error(`Unknown remote '${positional[0]}'.`)
      }

      branch = positional[1]
    } else if (positional.length === 1 && positional[0] !== 'origin') {
      this.error(
        `Unknown remote '${positional[0]}'. Use 'brv vc push origin ${positional[0]}' to push a specific branch.`,
      )
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcPushResponse>(VcEvents.PUSH, {
          branch,
          setUpstream: flags['set-upstream'],
        }),
      )

      if (result.alreadyUpToDate) {
        this.log('Everything up-to-date.')
      } else if (result.upstreamSet) {
        this.log(`Pushed to origin/${result.branch} and set upstream.`)
      } else {
        this.log(`Pushed to origin/${result.branch}.`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
