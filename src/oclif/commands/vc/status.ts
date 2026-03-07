import {Command} from '@oclif/core'
import chalk from 'chalk'

import {type IVcStatusResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcStatus extends Command {
  public static description = 'Show git status of the context tree'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcStatusResponse>(VcEvents.STATUS, {}),
      )
      this.formatOutput(result)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  private formatOutput(result: IVcStatusResponse): void {
    if (result.branch) {
      this.log(chalk.bold(`On branch: ${result.branch}`))
    } else {
      this.log(chalk.yellow('Git repository not initialized — run `brv vc init` to initialize'))
      return
    }

    const {staged, unstaged, untracked} = result
    const hasChanges =
      staged.added.length > 0 ||
      staged.modified.length > 0 ||
      staged.deleted.length > 0 ||
      unstaged.modified.length > 0 ||
      unstaged.deleted.length > 0 ||
      untracked.length > 0

    if (!hasChanges) {
      this.log('Nothing to commit, working tree clean')
      return
    }

    if (staged.added.length > 0 || staged.modified.length > 0 || staged.deleted.length > 0) {
      this.log(chalk.bold('Changes to be committed:'))
      for (const f of staged.added) this.log(chalk.green(`   new file:   ${f}`))
      for (const f of staged.modified) this.log(chalk.green(`   modified:   ${f}`))
      for (const f of staged.deleted) this.log(chalk.green(`   deleted:    ${f}`))
    }

    if (unstaged.modified.length > 0 || unstaged.deleted.length > 0) {
      this.log(chalk.bold('Changes not staged for commit:'))
      for (const f of unstaged.modified) this.log(chalk.red(`   modified:   ${f}`))
      for (const f of unstaged.deleted) this.log(chalk.red(`   deleted:    ${f}`))
    }

    if (untracked.length > 0) {
      this.log(chalk.bold('Untracked files:'))
      for (const f of untracked) this.log(chalk.red(`   ${f}`))
    }
  }
}
