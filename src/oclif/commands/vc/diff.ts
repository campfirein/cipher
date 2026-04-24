import {Args, Command, Flags} from '@oclif/core'

import {
  type IVcDiffsRequest,
  type IVcDiffsResponse,
  VcEvents,
} from '../../../shared/transport/events/vc-events.js'
import {formatDiff} from '../../../tui/features/vc/diff/utils/format-diff.js'
import {parseMode} from '../../../tui/features/vc/diff/utils/parse-mode.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcDiff extends Command {
  public static args = {
    ref: Args.string({description: 'commit, branch, or <ref1>..<ref2> range'}),
  }
  public static description = 'Show changes between commits, the index, or the working tree'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --staged',
    '<%= config.bin %> <%= command.id %> HEAD~1',
    '<%= config.bin %> <%= command.id %> main..feature/x',
    '<%= config.bin %> <%= command.id %> main',
  ]
  public static flags = {
    staged: Flags.boolean({description: 'Show staged changes (HEAD vs index)'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcDiff)

    let request: IVcDiffsRequest
    try {
      request = {mode: parseMode(args.ref, flags.staged)}
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error))
    }

    try {
      const response = await withDaemonRetry<IVcDiffsResponse>((client) =>
        client.requestWithAck<IVcDiffsResponse>(VcEvents.DIFFS, request),
      )
      const text = formatDiff(response)
      if (text.length > 0) process.stdout.write(text)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
