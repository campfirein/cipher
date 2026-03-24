import {Args, Command, Flags} from '@oclif/core'
import {resolve} from 'node:path'

import {addKnowledgeLink} from '../../server/core/domain/knowledge/knowledge-link-operations.js'
import {resolveProject} from '../../server/infra/project/resolve-project.js'

export default class LinkKnowledge extends Command {
  static args = {
    path: Args.string({
      description: "Path to the target project containing .brv/",
      required: true,
    }),
  }
  static description = "Add a read-only knowledge link to another project's context tree"
  static examples = [
    '<%= config.bin %> <%= command.id %> /path/to/shared-lib',
    '<%= config.bin %> <%= command.id %> /path/to/shared-lib --alias shared',
  ]
  static flags = {
    alias: Flags.string({
      description: 'Custom alias for the linked project (defaults to directory name)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(LinkKnowledge)

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

    const targetPath = resolve(args.path)
    const result = addKnowledgeLink(projectRoot, targetPath, flags.alias)

    if (result.success) {
      this.log(result.message)
    } else {
      this.error(result.message, {exit: 1})
    }
  }
}
