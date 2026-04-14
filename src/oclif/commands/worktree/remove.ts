import {Args, Command} from '@oclif/core'
import {resolve} from 'node:path'

import {WorktreeEvents, type WorktreeRemoveResponse} from '../../../shared/transport/events/worktree-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class WorktreeRemove extends Command {
  static args = {
    path: Args.string({
      description: 'Path to the worktree to remove (defaults to cwd)',
      required: false,
    }),
  }
  static description = 'Remove a worktree registration and its .brv pointer'
  static examples = [
    '<%= config.bin %> <%= command.id %>  (remove cwd as worktree)',
    '<%= config.bin %> <%= command.id %> packages/api  (remove from parent)',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(WorktreeRemove)
    const targetPath = args.path ? resolve(args.path) : resolve(process.cwd())

    try {
      const result = await withDaemonRetry<WorktreeRemoveResponse>(
        async (client) =>
          client.requestWithAck<WorktreeRemoveResponse>(WorktreeEvents.REMOVE, {
            worktreePath: targetPath,
          }),
        {projectPath: process.cwd()},
      )

      if (result.success) {
        this.log(result.message)
      } else {
        this.error(result.message, {exit: 1})
      }
    } catch (error) {
      this.error(formatConnectionError(error), {exit: 1})
    }
  }
}
