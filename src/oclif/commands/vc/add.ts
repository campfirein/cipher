import {Command} from '@oclif/core'

import {type IVcAddResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcAdd extends Command {
  public static description = 'Stage files for the next commit'
  public static examples = [
    '<%= config.bin %> <%= command.id %> .',
    '<%= config.bin %> <%= command.id %> notes.md',
    '<%= config.bin %> <%= command.id %> design/architecture.md',
    '<%= config.bin %> <%= command.id %> docs/',
  ]
  public static strict = false

  public async run(): Promise<void> {
    const {argv} = await this.parse(VcAdd)
    const filePaths: string[] = argv.length > 0 ? argv.filter((a): a is string => typeof a === 'string') : ['.']

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcAddResponse>(VcEvents.ADD, {filePaths}),
      )

      if (result.count === 0) {
        this.log('Nothing to stage.')
      } else {
        this.log(`Staged ${result.count} file(s).`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
