import {Command} from '@oclif/core'
import {unlinkSync} from 'node:fs'

import {findNearestWorktreeLink} from '../../../server/infra/project/resolve-project.js'

export default class WorktreeRemove extends Command {
  static description = 'Remove worktree link (.brv-worktree.json) from current directory or nearest ancestor'
  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    const linkFile = findNearestWorktreeLink()

    if (!linkFile) {
      this.log('No .brv-worktree.json found in current directory or any ancestor.')

      return
    }

    try {
      unlinkSync(linkFile)
      this.log(`Removed worktree link: ${linkFile}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Failed to remove worktree link: ${message}`, {exit: 1})
    }
  }
}
