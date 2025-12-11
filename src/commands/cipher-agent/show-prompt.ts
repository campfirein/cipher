import {Command} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'

import {isDevelopment} from '../../config/environment.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {getErrorMessage} from '../../utils/error-helpers.js'

export default class CipherAgentShowPrompt extends Command {
  static override description = 'Show the current CipherAgent system prompt [Development only]'
  static override examples = ['<%= config.bin %> <%= command.id %>']
  static override hidden = !isDevelopment()
  protected terminal: ITerminal = {} as ITerminal

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
  } {
    this.terminal = new OclifTerminal(this)
    return {
      projectConfigStore: new ProjectConfigStore(),
    }
  }

  public async run(): Promise<void> {
    const {projectConfigStore} = this.createServices()

    if (!isDevelopment()) {
      this.terminal.error('This command is only available in development environment')
      return
    }

    try {
      // Check if config exists
      const configExists = await projectConfigStore.exists()
      if (!configExists) {
        this.terminal.log('No ByteRover config found.')
        this.terminal.log('CipherAgent will use the default system prompt.')
        return
      }

      // Read existing config
      const config = await projectConfigStore.read()
      if (!config) {
        this.terminal.error('Failed to read config.')
        return
      }

      // Show system prompt
      if (config.cipherAgentSystemPrompt) {
        this.terminal.log('Current CipherAgent system prompt:')
        this.terminal.log('─'.repeat(60))
        this.terminal.log(config.cipherAgentSystemPrompt)
        this.terminal.log('─'.repeat(60))
      } else {
        this.terminal.log('No custom system prompt configured.')
        this.terminal.log('CipherAgent is using the default system prompt.')
      }
    } catch (error) {
      this.terminal.error(`Failed to show system prompt: ${getErrorMessage(error)}`)
    }
  }
}
