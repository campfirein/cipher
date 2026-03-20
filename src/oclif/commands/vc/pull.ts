import {Args, Command, Flags} from '@oclif/core'

import {type IVcPullResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcPull extends Command {
  public static args = {
    arg1: Args.string({description: 'Remote name (only origin supported)', required: false}),
    arg2: Args.string({description: 'Branch to pull', required: false}),
  }
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

    if (args.arg1 && args.arg2) {
      if (args.arg1 !== 'origin') {
        this.error(`Unknown remote '${args.arg1}'.`)
      }

      remote = args.arg1
      branch = args.arg2
    } else if (args.arg1) {
      if (args.arg1 !== 'origin') {
        this.error(`Unknown remote '${args.arg1}'.`)
      }

      remote = args.arg1
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcPullResponse>(VcEvents.PULL, {
          allowUnrelatedHistories: flags['allow-unrelated-histories'],
          branch,
          remote,
        }, {timeout: 120_000}),
      )

      this.log(result.alreadyUpToDate ? 'Already up to date.' : `Pulled from origin/${result.branch}.`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
