import chalk from 'chalk'

import type {SlashCommand} from '../../../types/commands.js'

// eslint-disable-next-line no-restricted-imports -- source commands need direct access to operations and resolver
import {listSourceStatuses} from '../../../../server/core/domain/source/source-operations.js'
// eslint-disable-next-line no-restricted-imports -- source commands need direct access to resolver
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'

export const sourceListSubCommand: SlashCommand = {
  action() {
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

    const result = listSourceStatuses(projectRoot)

    if (result.error) {
      return {
        content: result.error,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    if (result.statuses.length === 0) {
      return {
        content: 'No knowledge sources configured.',
        messageType: 'info' as const,
        type: 'message' as const,
      }
    }

    const lines: string[] = ['Knowledge Sources:']
    for (const link of result.statuses) {
      if (link.valid) {
        const sizeInfo = link.contextTreeSize === undefined ? '' : ` [${link.contextTreeSize} files]`
        lines.push(`   ${link.alias} → ${link.projectRoot} ${chalk.green('(valid)')}${sizeInfo}`)
      } else {
        lines.push(`   ${link.alias} → ${link.projectRoot} ${chalk.red(`[BROKEN - run /source remove ${link.alias}]`)}`)
      }
    }

    return {
      content: lines.join('\n'),
      messageType: 'info' as const,
      type: 'message' as const,
    }
  },
  description: 'List all knowledge sources and their status',
  name: 'list',
}
