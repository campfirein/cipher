import {Command} from '@oclif/core'
import chalk from 'chalk'

import {listSourceStatuses} from '../../../server/core/domain/source/source-operations.js'
import {resolveProject} from '../../../server/infra/project/resolve-project.js'

export default class SourceList extends Command {
  static description = 'List all knowledge sources and their status'
  static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    // Resolve local project root
    let projectRoot: string
    try {
      const resolution = resolveProject()
      if (!resolution) {
        this.error("No ByteRover project found. Run 'brv' first to initialize.", {exit: 1})

        return
      }

      projectRoot = resolution.projectRoot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Failed to resolve project: ${message}`, {exit: 1})

      return
    }

    const result = listSourceStatuses(projectRoot)

    if (result.error) {
      this.error(result.error, {exit: 1})

      return
    }

    if (result.statuses.length === 0) {
      this.log('No knowledge sources configured.')

      return
    }

    this.log('Knowledge Sources:')
    for (const link of result.statuses) {
      if (link.valid) {
        const sizeInfo = link.contextTreeSize === undefined ? '' : ` [${link.contextTreeSize} files]`
        this.log(`   ${link.alias} → ${link.projectRoot} ${chalk.green('(valid)')}${sizeInfo}`)
      } else {
        this.log(`   ${link.alias} → ${link.projectRoot} ${chalk.red(`[BROKEN - run brv source remove ${link.alias}]`)}`)
      }
    }
  }
}
