import {Command, Flags} from '@oclif/core'

import {type IVcCommitResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcCommit extends Command {
  public static description = 'Save staged changes as a commit'
  public static examples = ['<%= config.bin %> <%= command.id %> -m "Add project architecture notes"']
  public static flags = {
    message: Flags.string({
      char: 'm',
      description: 'Commit message',
    }),
  }
public static strict = false

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(VcCommit)

    // Support unquoted multi-word messages: brv vc commit -m hello world
    const extra = (argv as string[]).join(' ')
    const message = flags.message
      ? (extra ? `${flags.message} ${extra}` : flags.message)
      : (extra || undefined)
    if (!message) {
      this.error('Usage: brv vc commit -m "<message>"')
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcCommitResponse>(VcEvents.COMMIT, {message}),
      )

      this.log(`[${result.sha.slice(0, 7)}] ${result.message}`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
