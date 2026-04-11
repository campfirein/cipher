import {Args, Command} from '@oclif/core'

import {SourceEvents, type SourceRemoveResponse} from '../../../shared/transport/events/source-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class SourceRemove extends Command {
  static args = {
    aliasOrPath: Args.string({
      description: 'Alias or path of the knowledge source to remove',
      required: true,
    }),
  }
  static description = 'Remove a knowledge source'
  static examples = [
    '<%= config.bin %> <%= command.id %> shared-lib',
    '<%= config.bin %> <%= command.id %> /path/to/shared-lib',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(SourceRemove)

    try {
      const result = await withDaemonRetry<SourceRemoveResponse>(
        async (client) =>
          client.requestWithAck<SourceRemoveResponse>(SourceEvents.REMOVE, {
            aliasOrPath: args.aliasOrPath,
          }),
        {projectPath: process.cwd()},
      )

      if (result.success) {
        this.log(result.message)
      } else {
        this.error(result.message, {exit: 1})
      }
    } catch (error) {
      this.error(formatConnectionError(error), {exit: 1})
    }
  }
}
