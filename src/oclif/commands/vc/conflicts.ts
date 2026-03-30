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

      const hasMarkers = result.files.length > 0
      const hasIndexConflicts = result.conflicts && result.conflicts.length > 0

      if (!hasMarkers && !hasIndexConflicts) {
        this.log('No conflict markers found.')
        return
      }

      const totalCount = result.files.length + (result.conflicts?.length ?? 0)
      this.log(chalk.bold(`Found ${totalCount} conflicted file${totalCount === 1 ? '' : 's'}:`))
      this.log('')
      for (const f of result.files) {
        this.log(chalk.red(`   ${f}`))
      }

      if (result.conflicts) {
        for (const c of result.conflicts) {
          this.log(chalk.red(`   ${c.path} (${c.type})`))
        }
      }

      this.log('')
      this.log(chalk.yellow('Resolve conflicts and run "brv vc add" before pushing.'))
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
