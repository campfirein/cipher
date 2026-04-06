import {Args, Command} from '@oclif/core'

import {type IVcFetchResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcFetch extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional order matters: remote before branch */
  public static args = {
    remote: Args.string({description: 'Remote name (only origin supported)', required: false}),
    branch: Args.string({description: 'Branch to fetch', required: false}),
  }
  /* eslint-enable perfectionist/sort-objects */
  public static description = 'Fetch refs from ByteRover cloud'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> origin',
    '<%= config.bin %> <%= command.id %> origin main',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(VcFetch)

    let remote: string | undefined
    let ref: string | undefined

    if (args.remote && args.branch) {
      if (args.remote !== 'origin') {
        this.error(`Only 'origin' remote is currently supported.`)
      }

      remote = args.remote
      ref = args.branch
    } else if (args.remote) {
      if (args.remote !== 'origin') {
        this.error(`Only 'origin' remote is currently supported.`)
      }

      remote = args.remote
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcFetchResponse>(VcEvents.FETCH, {ref, remote}, {timeout: 120_000}),
      )

      this.log(`Fetched from ${result.remote}.`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
