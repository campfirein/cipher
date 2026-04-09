import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- source commands need direct access to operations and resolver
import {removeSource} from '../../../../server/core/domain/source/source-operations.js'
// eslint-disable-next-line no-restricted-imports -- source commands need direct access to resolver
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'

export const sourceRemoveSubCommand: SlashCommand = {
  action(_context, args) {
    const argTrimmed = args?.trim()
    if (!argTrimmed) {
      return {
        content: 'Usage: /source remove <alias-or-path>',
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

    const result = removeSource(projectRoot, argTrimmed)

    return {
      content: result.message,
      messageType: result.success ? ('info' as const) : ('error' as const),
      type: 'message' as const,
    }
  },
  args: [
    {
      description: 'Alias or path of the knowledge source to remove',
      name: 'aliasOrPath',
      required: true,
    },
  ],
  description: 'Remove a knowledge source',
  name: 'remove',
}
