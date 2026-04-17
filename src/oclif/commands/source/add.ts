import {Args, Command, Flags} from '@oclif/core'
import {resolve} from 'node:path'

import {type SourceAddResponse, SourceEvents} from '../../../shared/transport/events/source-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class SourceAdd extends Command {
  static args = {
    path: Args.string({
      description: 'Path to the target project containing .brv/',
      required: true,
    }),
  }
  static description = "Add a read-only knowledge source from another project's context tree"
  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/shared-lib',
    '<%= config.bin %> <%= command.id %> /path/to/shared-lib --alias shared',
  ]
  static flags = {
    alias: Flags.string({
      description: 'Custom alias for the source (defaults to directory name)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(SourceAdd)
    const targetPath = resolve(args.path)

    try {
      const result = await withDaemonRetry<SourceAddResponse>(
        async (client) =>
          client.requestWithAck<SourceAddResponse>(SourceEvents.ADD, {
            alias: flags.alias,
            targetPath,
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
