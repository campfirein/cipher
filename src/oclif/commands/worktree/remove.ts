import {Args, Command} from '@oclif/core'
import {resolve} from 'node:path'

import {isWorktreePointer, removeWorktree} from '../../../server/infra/project/resolve-project.js'
import {resolvePath} from '../../../server/utils/path-utils.js'

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
    const cwd = resolvePath(process.cwd())

    const targetPath = args.path
      ? resolvePath(resolve(args.path))
      : cwd

    if (!isWorktreePointer(targetPath)) {
      this.log(`"${targetPath}" is not a worktree (no .brv pointer file found).`)

      return
    }

    const result = removeWorktree(targetPath)

    if (result.success) {
      this.log(result.message)
    } else {
      this.error(result.message, {exit: 1})
    }
  }
}
