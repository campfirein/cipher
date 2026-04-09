import {resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- worktree remove needs direct access to resolver and CRUD helpers
import {isWorktreePointer, removeWorktree, resolveProject} from '../../../../server/infra/project/resolve-project.js'
import {ClientEvents} from '../../../../shared/transport/events/client-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const worktreeRemoveSubCommand: SlashCommand = {
  action(_context, args) {
    const cwd = resolve(resolve(process.cwd()))
    const argTrimmed = args?.trim()
    const targetPath = argTrimmed ? resolve(resolve(argTrimmed)) : cwd

    if (!isWorktreePointer(targetPath)) {
      return {
        content: `"${targetPath}" is not a worktree (no .brv pointer file found).`,
        messageType: 'info' as const,
        type: 'message' as const,
      }
    }

    const result = removeWorktree(targetPath)

    if (!result.success) {
      return {
        content: result.message,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    // Re-resolve after removal
    let resolution: ReturnType<typeof resolveProject> = null
    try {
      resolution = resolveProject()
    } catch {
      // Resolution failed — no valid project found after removal
    }

    const store = useTransportStore.getState()
    store.setProjectInfo(resolution?.projectRoot, resolution?.worktreeRoot)

    if (resolution?.projectRoot) {
      store.client
        ?.requestWithAck(ClientEvents.ASSOCIATE_PROJECT, {projectPath: resolution.projectRoot})
        .catch(() => {
          // Best-effort: server may not be reachable
        })
    }

    return {
      content: result.message,
      messageType: 'info' as const,
      type: 'message' as const,
    }
  },
  args: [
    {
      description: 'Path to the worktree to remove (defaults to current directory)',
      name: 'path',
      required: false,
    },
  ],
  description: 'Remove a worktree registration',
  name: 'remove',
}
