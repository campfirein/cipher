import {Args, Command, Flags} from '@oclif/core'

import {type IVcLogRequest, type IVcLogResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatCommitLog} from '../../../tui/features/log/utils/format-log.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcLog extends Command {
  public static args = {
    branch: Args.string({description: 'Branch name to show history for'}),
  }
  public static description = 'Show commit history for the context-tree'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --limit 20',
    '<%= config.bin %> <%= command.id %> main',
    '<%= config.bin %> <%= command.id %> --all',
  ]
  public static flags = {
    all: Flags.boolean({
      char: 'a',
      default: false,
      description: 'Show commits from all branches',
    }),
    limit: Flags.integer({
      default: 10,
      description: 'Number of commits to show',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcLog)

    try {
      const response = await withDaemonRetry<IVcLogResponse>((client) => {
        const req: IVcLogRequest = {
          all: flags.all,
          limit: flags.limit,
          ref: args.branch,
        }
        return client.requestWithAck<IVcLogResponse>(VcEvents.LOG, req)
      })

      if (response.commits.length === 0) {
        this.log('No commits found.')
        return
      }

      this.log(formatCommitLog(response.commits, response.currentBranch))
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
