import {resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- worktree add needs direct access to resolver and CRUD helpers
import {addWorktree, findParentProject, hasBrvConfig, resolveProject} from '../../../../server/infra/project/resolve-project.js'
import {ClientEvents} from '../../../../shared/transport/events/client-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const worktreeAddSubCommand: SlashCommand = {
  action(_context, args) {
    const cwd = resolve(resolve(process.cwd()))
    const argTrimmed = args?.trim()

    let projectRoot: string
    let worktreePath: string

    if (argTrimmed) {
      // Mode A: from parent — /worktree add <path>
      if (!hasBrvConfig(cwd)) {
        return {
          content: "Current directory is not a ByteRover project. Run 'brv' first to initialize, or run '/worktree add' from a subdirectory.",
          messageType: 'error' as const,
          type: 'message' as const,
        }
      }

      projectRoot = cwd
      worktreePath = resolve(resolve(argTrimmed))
    } else {
      // Mode B: from subdirectory — /worktree add (auto-detect parent)
      const parent = findParentProject(cwd)
      if (!parent) {
        return {
          content: 'No parent project found. Run from the project root and provide a path: /worktree add <path>',
          messageType: 'error' as const,
          type: 'message' as const,
        }
      }

      projectRoot = parent
      worktreePath = cwd
    }

    const result = addWorktree(projectRoot, worktreePath, {force: true})

    if (!result.success) {
      return {
        content: result.message,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    // Re-resolve so transport store and daemon pick up the new pointer
    let resolution: ReturnType<typeof resolveProject> = null
    try {
      resolution = resolveProject()
    } catch {
      // Fall back to using target as project root
    }

    const store = useTransportStore.getState()
    store.setProjectInfo(resolution?.projectRoot ?? projectRoot, resolution?.worktreeRoot ?? worktreePath)
    store.client
      ?.requestWithAck(ClientEvents.ASSOCIATE_PROJECT, {projectPath: resolution?.projectRoot ?? projectRoot})
      .catch(() => {
        // Best-effort: server may not be reachable
      })

    return {
      content: result.message + ' Run /status to verify.',
      messageType: 'info' as const,
      type: 'message' as const,
    }
  },
  args: [
    {
      description: 'Path to the directory to register as a worktree (auto-detects parent if omitted)',
      name: 'path',
      required: false,
    },
  ],
  description: 'Register a directory as a worktree of a project',
  name: 'add',
}
