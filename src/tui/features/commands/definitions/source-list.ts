import chalk from 'chalk'

import type {SlashCommand} from '../../../types/commands.js'

import {listSourcesViaTransport} from '../../source/api/source-api.js'

export const sourceListSubCommand: SlashCommand = {
  async action() {
    try {
      const result = await listSourcesViaTransport()

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
      for (const source of result.statuses) {
        if (source.valid) {
          const sizeInfo = source.contextTreeSize === undefined ? '' : ` [${source.contextTreeSize} files]`
          lines.push(`   ${source.alias} → ${source.projectRoot} ${chalk.green('(valid)')}${sizeInfo}`)
        } else {
          lines.push(
            `   ${source.alias} → ${source.projectRoot} ${chalk.red(`[BROKEN - run /source remove ${source.alias}]`)}`,
          )
        }
      }

      return {
        content: lines.join('\n'),
        messageType: 'info' as const,
        type: 'message' as const,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: `Source list failed: ${message}`,
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }
  },
  description: 'List all knowledge sources and their status',
  name: 'list',
}
