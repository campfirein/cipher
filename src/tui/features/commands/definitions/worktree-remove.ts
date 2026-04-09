import {existsSync, unlinkSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- worktree remove must re-resolve project after removing workspace link
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'
import {ClientEvents} from '../../../../shared/transport/events/client-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

const WORKTREE_LINK_FILE = '.brv-worktree.json'

function findNearestLink(): null | string {
  let current = resolve(process.cwd())
  const root = resolve('/')

  while (current !== root) {
    const linkFile = join(current, WORKTREE_LINK_FILE)
    if (existsSync(linkFile)) {
      return linkFile
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

export const worktreeRemoveSubCommand: SlashCommand = {
  action() {
    const linkFile = findNearestLink()

    if (!linkFile) {
      return {
        content: 'No .brv-worktree.json found in current directory or any ancestor.',
        messageType: 'info' as const,
        type: 'message' as const,
      }
    }

    try {
      unlinkSync(linkFile)

      // Re-resolve after removal so both reconnects and task payloads use the
      // walked-up project root instead of the raw subdirectory cwd.
      let resolution: ReturnType<typeof resolveProject> = null
      try {
        resolution = resolveProject()
      } catch {
        // Resolution failed — no valid project found after removal
      }

      const store = useTransportStore.getState()
      store.setProjectInfo(resolution?.projectRoot, resolution?.worktreeRoot)

      // Only reassociate if we found a valid project; otherwise skip to avoid
      // registering a non-project directory in the daemon's room/agent mapping.
      if (resolution?.projectRoot) {
        store.client
          ?.requestWithAck(ClientEvents.ASSOCIATE_PROJECT, {projectPath: resolution.projectRoot})
          .catch(() => {
            // Best-effort: server may not be reachable
          })
      }

      return {
        content: `Removed worktree link: ${linkFile}`,
        messageType: 'info' as const,
        type: 'message' as const,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return {
        content: `Failed to remove worktree link: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  description: 'Remove worktree link (.brv-worktree.json)',
  name: 'remove',
}
