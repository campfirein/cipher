import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- worktree list reads canonical resolution directly
import {listWorktrees, resolveProject} from '../../../../server/infra/project/resolve-project.js'

export const worktreeListSubCommand: SlashCommand = {
  action() {
    let resolution: ReturnType<typeof resolveProject> = null
    try {
      resolution = resolveProject()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return {
        content: message,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    if (!resolution) {
      return {
        content: 'No ByteRover project found in current directory.',
        messageType: 'info' as const,
        type: 'message' as const,
      }
    }

    const lines: string[] = []
    if (resolution.source === 'linked') {
      lines.push(`Worktree: ${resolution.worktreeRoot}`, `Linked to: ${resolution.projectRoot}`)
    } else {
      lines.push(`Project: ${resolution.projectRoot}`)
    }

    const worktrees = listWorktrees(resolution.projectRoot)
    if (worktrees.length > 0) {
      lines.push('', 'Registered worktrees:')
      for (const wt of worktrees) {
        lines.push(`   ${wt.name} → ${wt.worktreePath}`)
      }
    }

    return {
      content: lines.join('\n'),
      messageType: 'info' as const,
      type: 'message' as const,
    }
  },
  description: 'Show the current worktree link and list all registered worktrees',
  name: 'list',
}
