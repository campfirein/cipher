import {Args, Command} from '@oclif/core'

import {removeSource} from '../../../server/core/domain/source/source-operations.js'
import {resolveProject} from '../../../server/infra/project/resolve-project.js'

export default class SourceRemove extends Command {
  static args = {
    aliasOrPath: Args.string({
      description: 'Alias or path of the knowledge source to remove',
      required: true,
    }),
  }
  static description = 'Remove a knowledge source'
  static examples = [
    '<%= config.bin %> <%= command.id %> shared-lib',
    '<%= config.bin %> <%= command.id %> /path/to/shared-lib',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(SourceRemove)

    // Resolve local project root
    let projectRoot: string
    try {
      const resolution = resolveProject()
      if (!resolution) {
        this.error("No ByteRover project found. Run 'brv' first to initialize.", {exit: 1})

        return
      }

      projectRoot = resolution.projectRoot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Failed to resolve project: ${message}`, {exit: 1})

      return
    }

    const result = removeSource(projectRoot, args.aliasOrPath)

    if (result.success) {
      this.log(result.message)
    } else {
      this.error(result.message, {exit: 1})
    }
  }
}
