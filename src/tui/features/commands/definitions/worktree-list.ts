import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- worktree list reads canonical resolution directly
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'

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
        content: 'No ByteRover project found in current directory or any ancestor.',
        messageType: 'info' as const,
        type: 'message' as const,
      }
    }

    const lines: string[] = []
    if (resolution.source === 'linked') {
      lines.push(`Worktree: ${resolution.worktreeRoot}`, `Linked to: ${resolution.projectRoot}`)
      if (resolution.linkFile) {
        lines.push(`Link file: ${resolution.linkFile}`)
      }
    } else {
      lines.push(`Project: ${resolution.projectRoot}`, 'No worktree link (running inside project root).')
    }

    return {
      content: lines.join('\n'),
      messageType: 'info' as const,
      type: 'message' as const,
    }
  },
  description: 'Show the current worktree link (if any)',
  name: 'list',
}
