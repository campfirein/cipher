import {resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- knowledge link commands need direct access to operations and resolver
import {addKnowledgeLink} from '../../../../server/core/domain/knowledge/knowledge-link-operations.js'
// eslint-disable-next-line no-restricted-imports -- knowledge link commands need direct access to resolver
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'

export const linkKnowledgeCommand: SlashCommand = {
  action(_context, args) {
    const argTrimmed = args?.trim()
    if (!argTrimmed) {
      return {
        content: 'Usage: /link-knowledge <path-to-project> — provide the path to the project to link.',
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

    const targetPath = resolve(argTrimmed)
    const result = addKnowledgeLink(projectRoot, targetPath)

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
  description: "Add a read-only knowledge link to another project's context tree",
  name: 'link-knowledge',
}
