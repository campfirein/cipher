import {Command} from '@oclif/core'

import {
  BrokenWorktreeLinkError,
  MalformedWorktreeLinkError,
  resolveProject,
} from '../../../server/infra/project/resolve-project.js'

export default class WorktreeList extends Command {
  static description = 'Show the current worktree link (if any)'
  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    let resolution: ReturnType<typeof resolveProject>
    try {
      resolution = resolveProject()
    } catch (error) {
      if (error instanceof BrokenWorktreeLinkError || error instanceof MalformedWorktreeLinkError) {
        this.error(error.message, {exit: 1})
      }

      throw error
    }

    if (!resolution) {
      this.log('No ByteRover project found in current directory or any ancestor.')

      return
    }

    if (resolution.source === 'linked') {
      this.log(`Worktree: ${resolution.worktreeRoot}`)
      this.log(`Linked to: ${resolution.projectRoot}`)
      if (resolution.linkFile) {
        this.log(`Link file: ${resolution.linkFile}`)
      }
    } else {
      this.log(`Project: ${resolution.projectRoot}`)
      this.log('No worktree link (running inside project root).')
    }
  }
}
