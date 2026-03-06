import {existsSync, unlinkSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

const WORKSPACE_LINK_FILE = '.brv-workspace.json'

function findNearestLink(): null | string {
  let current = resolve(process.cwd())
  const root = resolve('/')

  while (current !== root) {
    const linkFile = join(current, WORKSPACE_LINK_FILE)
    if (existsSync(linkFile)) {
      return linkFile
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

export const unlinkCommand: SlashCommand = {
  action() {
    const linkFile = findNearestLink()

    if (!linkFile) {
      return {
        content: 'No .brv-workspace.json found in current directory or any ancestor.',
        messageType: 'info' as const,
        type: 'message' as const,
      }
    }

    try {
      unlinkSync(linkFile)

      return {
        content: `Removed workspace link: ${linkFile}`,
        messageType: 'info' as const,
        type: 'message' as const,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return {
        content: `Failed to remove workspace link: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  description: 'Remove workspace link (.brv-workspace.json)',
  name: 'unlink',
}
