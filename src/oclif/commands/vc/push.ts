import {Args, Command, Flags} from '@oclif/core'

import {type IVcPushResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPush extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional order matters: remote before branch */
  public static args = {
    remote: Args.string({description: 'Remote name (only origin supported)', required: false}),
    branch: Args.string({description: 'Branch to push', required: false}),
  }
  /* eslint-enable perfectionist/sort-objects */
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
    if (args.remote && args.branch) {
      if (args.remote !== 'origin') {
        this.error(`Only 'origin' remote is currently supported.`)
      }

      branch = args.branch
    } else if (args.remote && args.remote !== 'origin') {
      this.error(`Only 'origin' remote is currently supported. Use 'brv vc push origin ${args.remote}' to push a specific branch.`)
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
