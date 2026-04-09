import {Command} from '@oclif/core'

import {
  BrokenWorktreePointerError,
  listWorktrees,
  MalformedWorktreePointerError,
  resolveProject,
} from '../../../server/infra/project/resolve-project.js'

export default class WorktreeList extends Command {
  static description = 'Show the current worktree link and list all registered worktrees'
  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    let resolution: ReturnType<typeof resolveProject>
    try {
      resolution = resolveProject()
    } catch (error) {
      if (error instanceof BrokenWorktreePointerError || error instanceof MalformedWorktreePointerError) {
        this.error(error.message, {exit: 1})
      }

      throw error
    }

    if (!resolution) {
      this.log('No ByteRover project found in current directory.')

      return
    }

    if (resolution.source === 'linked') {
      this.log(`Worktree: ${resolution.worktreeRoot}`)
      this.log(`Linked to: ${resolution.projectRoot}`)
    } else {
      this.log(`Project: ${resolution.projectRoot}`)
    }

    // List all registered worktrees
    const worktrees = listWorktrees(resolution.projectRoot)
    if (worktrees.length > 0) {
      this.log('\nRegistered worktrees:')
      for (const wt of worktrees) {
        this.log(`   ${wt.name} → ${wt.worktreePath}`)
      }
    }
  }
}
