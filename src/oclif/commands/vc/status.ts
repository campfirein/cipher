import {Command} from '@oclif/core'
import chalk from 'chalk'

import {type IVcStatusResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcStatus extends Command {
  public static description = 'Show ByteRover version control status'
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
    if (!result.initialized) {
      this.log(chalk.yellow('ByteRover version control not initialized — run `brv vc init` to initialize'))
      return
    }

    this.log(chalk.bold(`On branch ${result.branch ?? '(detached HEAD)'}`))

    if (result.hasCommits === false) {
      this.log(chalk.yellow('No commits yet'))
    }

    if (result.trackingBranch) {
      const ahead = result.ahead ?? 0
      const behind = result.behind ?? 0
      if (ahead > 0 && behind > 0) {
        this.log(
          `Your branch and '${result.trackingBranch}' have diverged,\n` +
            `and have ${ahead} and ${behind} different commits each, respectively.`,
        )
      } else if (ahead > 0) {
        this.log(`Your branch is ahead of '${result.trackingBranch}' by ${ahead} commit${ahead === 1 ? '' : 's'}.`)
      } else if (behind > 0) {
        this.log(`Your branch is behind '${result.trackingBranch}' by ${behind} commit${behind === 1 ? '' : 's'}.`)
      }
    }

    const {staged, unstaged, untracked} = result
    const hasChanges =
      staged.added.length > 0 ||
      staged.modified.length > 0 ||
      staged.deleted.length > 0 ||
      unstaged.modified.length > 0 ||
      unstaged.deleted.length > 0 ||
      untracked.length > 0

    if (result.mergeInProgress) {
      const hasUnmerged = result.unmerged && result.unmerged.length > 0
      if (hasUnmerged) {
        this.log(chalk.yellow('You have unmerged paths.'))
        this.log(chalk.yellow('  (fix conflicts and run "brv vc add", then "brv vc merge --continue")'))
        this.log('')
        this.log(chalk.bold('Unmerged paths:'))
        for (const f of result.unmerged!) {
          const label =
            f.type === 'deleted_modified' ? 'deleted by them' : f.type === 'both_added' ? 'both added' : 'both modified'
          this.log(chalk.red(`   ${label}:   ${f.path}`))
        }
      } else {
        this.log(chalk.yellow('All conflicts fixed but you are still merging.'))
        this.log(chalk.yellow('  (use "brv vc merge --continue" to conclude merge)'))
        if (!hasChanges) return
      }
    } else if (!hasChanges && !(result.conflictMarkerFiles && result.conflictMarkerFiles.length > 0)) {
      this.log('Nothing to commit, working directory clean')
      return
    }

    if (result.conflictMarkerFiles && result.conflictMarkerFiles.length > 0) {
      this.log(chalk.yellow('Files with conflict markers:'))
      this.log(chalk.yellow('  (resolve conflicts and run "brv vc add" before pushing)'))
      this.log('')
      for (const f of result.conflictMarkerFiles) {
        this.log(chalk.red(`   ${f} (conflict)`))
      }
    }

    this.printChangeSections(result)
  }

  private printChangeSections(result: IVcStatusResponse): void {
    const {staged, unstaged, untracked} = result

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
      this.log(chalk.bold('(use "brv vc add ‹file>..." to include in what will be committed)'))
      for (const f of untracked) this.log(chalk.red(`   ${f}`))
    }
  }
}
