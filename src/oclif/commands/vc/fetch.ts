import {Args, Command} from '@oclif/core'

import {type IVcFetchResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcFetch extends Command {
  public static args = {
    arg1: Args.string({description: 'Remote name (only origin supported)', required: false}),
    arg2: Args.string({description: 'Branch to fetch', required: false}),
  }
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

    if (args.arg1 && args.arg2) {
      if (args.arg1 !== 'origin') {
        this.error(`Unknown remote '${args.arg1}'.`)
      }

      remote = args.arg1
      ref = args.arg2
    } else if (args.arg1) {
      if (args.arg1 !== 'origin') {
        this.error(`Unknown remote '${args.arg1}'.`)
      }

      remote = args.arg1
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
