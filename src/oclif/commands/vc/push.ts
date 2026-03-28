import {Args, Command, Flags} from '@oclif/core'

import {type IVcPushResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPush extends Command {
  public static args = {
    arg1: Args.string({description: 'Remote name or branch', required: false}),
    arg2: Args.string({description: 'Branch to push', required: false}),
  }
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

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcPush)

    // Git push semantics: push [<remote> [<branch>]]
    //   brv vc push                → current branch
    //   brv vc push origin         → current branch (explicit remote)
    //   brv vc push origin feat/x  → feat/x
    //   brv vc push feat/x         → error (unknown remote)
    let branch: string | undefined
    if (args.arg1 && args.arg2) {
      if (args.arg1 !== 'origin') {
        this.error(`Only 'origin' remote is currently supported.`)
      }

      branch = args.arg2
    } else if (args.arg1 && args.arg1 !== 'origin') {
      this.error(`Only 'origin' remote is currently supported. Use 'brv vc push origin ${args.arg1}' to push a specific branch.`)
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcPushResponse>(VcEvents.PUSH, {
          branch,
          setUpstream: flags['set-upstream'],
        }, {timeout: 120_000}),
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
