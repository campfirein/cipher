import {Command} from '@oclif/core'
import {unlinkSync} from 'node:fs'

import {findNearestWorkspaceLink} from '../../server/infra/project/resolve-project.js'

export default class Unlink extends Command {
  static description = 'Remove workspace link (.brv-workspace.json) from current directory or nearest ancestor'
static examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<void> {
    const linkFile = findNearestWorkspaceLink()

    if (!linkFile) {
      this.log('No .brv-workspace.json found in current directory or any ancestor.')

      return
    }

    try {
      unlinkSync(linkFile)
      this.log(`Removed workspace link: ${linkFile}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Failed to remove workspace link: ${message}`, {exit: 1})
    }
  }
}
