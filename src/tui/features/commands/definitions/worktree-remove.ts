import {resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

import {removeWorktreeViaTransport} from '../../worktree/api/worktree-api.js'

export const worktreeRemoveSubCommand: SlashCommand = {
  async action(_context, args) {
    const argTrimmed = args?.trim()
    const targetPath = argTrimmed ? resolve(argTrimmed) : resolve(process.cwd())

    try {
      const result = await removeWorktreeViaTransport(targetPath)

      return {
        content: result.message,
        messageType: result.success ? ('info' as const) : ('error' as const),
        type: 'message' as const,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: `Worktree remove failed: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
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
