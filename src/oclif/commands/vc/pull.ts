import {Args, Command, Flags} from '@oclif/core'

import {type IVcPullResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPull extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional order matters: remote before branch */
  public static args = {
    remote: Args.string({description: 'Remote name (only origin supported)', required: false}),
    branch: Args.string({description: 'Branch to pull', required: false}),
  }
  /* eslint-enable perfectionist/sort-objects */
  public static description = 'Pull commits from ByteRover cloud'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> origin main',
    '<%= config.bin %> <%= command.id %> origin main --allow-unrelated-histories',
  ]
  public static flags = {
    'allow-unrelated-histories': Flags.boolean({
      default: false,
      description: 'Allow merging unrelated histories',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcPull)

    let remote: string | undefined
    let branch: string | undefined

    if (args.remote && args.branch) {
      if (args.remote !== 'origin') {
        this.error(`Only 'origin' remote is currently supported.`)
      }

      remote = args.remote
      branch = args.branch
    } else if (args.remote) {
      if (args.remote !== 'origin') {
        this.error(`Only 'origin' remote is currently supported.`)
      }

      remote = args.remote
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcPullResponse>(VcEvents.PULL, {
          allowUnrelatedHistories: flags['allow-unrelated-histories'],
          branch,
          remote,
        }, {timeout: 120_000}),
      )

      if (result.conflicts && result.conflicts.length > 0) {
        for (const conflict of result.conflicts) {
          this.log(`CONFLICT (${conflict.type}): ${conflict.path}`)
        }

        this.log('Automatic merge failed; fix conflicts and then commit the result.')
      } else {
        this.log(result.alreadyUpToDate ? 'Already up to date.' : `Pulled from origin/${result.branch}.`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
