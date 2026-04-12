import {Args, Command, Flags} from '@oclif/core'
import {resolve} from 'node:path'

import {type WorktreeAddResponse, WorktreeEvents} from '../../../shared/transport/events/worktree-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class WorktreeAdd extends Command {
  static args = {
    path: Args.string({
      description: 'Path to the directory to register as a worktree (relative or absolute)',
      required: false,
    }),
  }
  static description = 'Register a directory as a worktree of this project'
  static examples = [
    '<%= config.bin %> <%= command.id %> packages/api',
    '<%= config.bin %> <%= command.id %> ../other-checkout',
    '<%= config.bin %> <%= command.id %>  (auto-detect parent from subdirectory)',
  ]
  static flags = {
    force: Flags.boolean({
      default: false,
      description: 'Replace existing .brv/ directory in target with a worktree pointer',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorktreeAdd)
    const cwd = resolve(process.cwd())
    const worktreePath = args.path ? resolve(args.path) : cwd

    try {
      const result = await withDaemonRetry<WorktreeAddResponse>(
        async (client) =>
          client.requestWithAck<WorktreeAddResponse>(WorktreeEvents.ADD, {
            force: flags.force,
            worktreePath,
          }),
        {projectPath: cwd},
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
