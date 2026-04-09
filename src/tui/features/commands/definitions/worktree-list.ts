import type {SlashCommand} from '../../../types/commands.js'

import {listWorktreesViaTransport} from '../../worktree/api/worktree-api.js'

export const worktreeListSubCommand: SlashCommand = {
  async action() {
    try {
      const result = await listWorktreesViaTransport()

      const lines: string[] = []
      if (result.source === 'linked') {
        lines.push(`Worktree: ${result.worktreeRoot}`, `Linked to: ${result.projectRoot}`)
      } else {
        lines.push(`Project: ${result.projectRoot}`)
      }

      if (result.worktrees.length > 0) {
        lines.push('', 'Registered worktrees:')
        for (const wt of result.worktrees) {
          lines.push(`   ${wt.name} → ${wt.worktreePath}`)
        }
      }

      return {
        content: lines.join('\n'),
        messageType: 'error',
        type: 'message',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: `Worktree list failed: ${message}`,
        messageType: 'error',
        type: 'message',
      }
    }
  },
  description: 'Show the current worktree link and list all registered worktrees',
  name: 'list',
}
