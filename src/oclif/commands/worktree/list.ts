import {Command} from '@oclif/core'

import {WorktreeEvents, type WorktreeListResponse} from '../../../shared/transport/events/worktree-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class WorktreeList extends Command {
  static description = 'Show the current worktree link and list all registered worktrees'
  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    try {
      const result = await withDaemonRetry<WorktreeListResponse>(
        async (client) => client.requestWithAck<WorktreeListResponse>(WorktreeEvents.LIST),
        {projectPath: process.cwd()},
      )

      if (result.source === 'linked') {
        this.log(`Worktree: ${result.worktreeRoot}`)
        this.log(`Linked to: ${result.projectRoot}`)
      } else {
        this.log(`Project: ${result.projectRoot}`)
      }

      if (result.worktrees.length > 0) {
        this.log('\nRegistered worktrees:')
        for (const wt of result.worktrees) {
          this.log(`   ${wt.name} → ${wt.worktreePath}`)
        }
      }
    } catch (error) {
      this.error(formatConnectionError(error), {exit: 1})
    }
  }
}
