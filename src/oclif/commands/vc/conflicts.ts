import {Command} from '@oclif/core'
import chalk from 'chalk'

import {type IVcConflictsResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcConflicts extends Command {
  public static description = 'List files with conflict markers'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcConflictsResponse>(VcEvents.CONFLICTS, {}),
      )

      if (result.files.length === 0) {
        this.log('No conflict markers found.')
        return
      }

      this.log(chalk.bold(`Found ${result.files.length} file${result.files.length === 1 ? '' : 's'} with conflict markers:`))
      this.log('')
      for (const f of result.files) {
        this.log(chalk.red(`   ${f}`))
      }

      this.log('')
      this.log(chalk.yellow('Resolve conflicts and run "brv vc add" before pushing.'))
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
