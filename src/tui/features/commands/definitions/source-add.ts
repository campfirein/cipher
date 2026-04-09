import {resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- source commands need direct access to operations and resolver
import {addSource} from '../../../../server/core/domain/source/source-operations.js'
// eslint-disable-next-line no-restricted-imports -- source commands need direct access to resolver
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'
import {Flags, parseReplArgs, toCommandFlags} from '../utils/arg-parser.js'

const sourceAddFlags = {
  alias: Flags.string({
    description: 'Custom alias for the source (defaults to directory name)',
  }),
}

export const sourceAddSubCommand: SlashCommand = {
  async action(_context, args) {
    const parsed = await parseReplArgs(args ?? '', {flags: sourceAddFlags, strict: false})

    const targetArg = parsed.argv[0]
    if (!targetArg) {
      return {
        content: 'Usage: /source add <path-to-project> [--alias <name>]',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    // Resolve local project root
    let projectRoot: string
    try {
      const resolution = resolveProject()
      if (!resolution) {
        return {
          content: "No ByteRover project found. Run 'brv' first to initialize.",
          messageType: 'error' as const,
          type: 'message' as const,
        }
      }

      projectRoot = resolution.projectRoot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return {
        content: `Failed to resolve project: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    const targetPath = resolve(targetArg)
    const result = addSource(projectRoot, targetPath, parsed.flags.alias)

    return {
      content: result.message,
      messageType: result.success ? ('info' as const) : ('error' as const),
      type: 'message' as const,
    }
  },
  args: [
    {
      description: 'Path to the target project containing .brv/',
      name: 'path',
      required: true,
    },
  ],
  description: "Add a read-only knowledge source from another project's context tree",
  flags: toCommandFlags(sourceAddFlags),
  name: 'add',
}
