import {Command} from '@oclif/core'
import chalk from 'chalk'

import {SourceEvents, type SourceListResponse} from '../../../shared/transport/events/source-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class SourceList extends Command {
  static description = 'List all knowledge sources and their status'
  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    try {
      const result = await withDaemonRetry<SourceListResponse>(
        async (client) => client.requestWithAck<SourceListResponse>(SourceEvents.LIST),
        {projectPath: process.cwd()},
      )

      if (result.error) {
        this.error(result.error, {exit: 1})
      }

      if (result.statuses.length === 0) {
        this.log('No knowledge sources configured.')

        return
      }

      this.log('Knowledge Sources:')
      for (const source of result.statuses) {
        if (source.valid) {
          const sizeInfo = source.contextTreeSize === undefined ? '' : ` [${source.contextTreeSize} files]`
          this.log(`   ${source.alias} → ${source.projectRoot} ${chalk.green('(valid)')}${sizeInfo}`)
        } else {
          this.log(
            `   ${source.alias} → ${source.projectRoot} ${chalk.red(`[BROKEN - run brv source remove ${source.alias}]`)}`,
          )
        }
      }
    } catch (error) {
      this.error(formatConnectionError(error), {exit: 1})
    }
  }
}
