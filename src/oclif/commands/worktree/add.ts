import {Args, Command, Flags} from '@oclif/core'
import {resolve} from 'node:path'

import {addWorktree, findParentProject, hasBrvConfig} from '../../../server/infra/project/resolve-project.js'
import {resolvePath} from '../../../server/utils/path-utils.js'

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
    const cwd = resolvePath(process.cwd())

    if (args.path) {
      // Mode A: run from parent — brv worktree add <path>
      if (!hasBrvConfig(cwd)) {
        this.error(
          'Current directory is not a ByteRover project (no .brv/config.json). ' +
          "Run 'brv' here first to initialize, or run 'brv worktree add' from a subdirectory to auto-detect the parent.",
          {exit: 1},
        )
      }

      const targetPath = resolvePath(resolve(args.path))
      const result = addWorktree(cwd, targetPath, {force: flags.force})

      if (result.success) {
        this.log(result.message)
      } else {
        this.error(result.message, {exit: 1})
      }
    } else {
      // Mode B: run from subdirectory — brv worktree add (auto-detect parent)
      const parentProject = findParentProject(cwd)
      if (!parentProject) {
        this.error(
          'No parent project found. Run from the project root and provide a path: brv worktree add <path>',
          {exit: 1},
        )
      }

      const result = addWorktree(parentProject, cwd, {force: flags.force})

      if (result.success) {
        this.log(result.message)
      } else {
        this.error(result.message, {exit: 1})
      }
    }
  }
}
