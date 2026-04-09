import {resolve} from 'node:path'

import type {SlashCommand} from '../../../types/commands.js'

import {addWorktreeViaTransport} from '../../worktree/api/worktree-api.js'

export const worktreeAddSubCommand: SlashCommand = {
  async action(_context, args) {
    const cwd = resolve(process.cwd())
    const argTrimmed = args?.trim()

    // Resolve worktree path: if argument provided, resolve relative to cwd; otherwise use cwd itself
    const worktreePath = argTrimmed ? resolve(argTrimmed) : cwd

    try {
      const result = await addWorktreeViaTransport(worktreePath, true)

      return {
        content: result.success ? result.message + ' Run /status to verify.' : result.message,
        messageType: result.success ? ('info' as const) : ('error' as const),
        type: 'message' as const,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: `Worktree add failed: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
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
