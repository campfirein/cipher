import {Command} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'

import {isDevelopment} from '../../config/environment.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {getErrorMessage} from '../../utils/error-helpers.js'

export default class CipherAgentShowPrompt extends Command {
  static override description = 'Show the current CipherAgent system prompt [Development only]'
  static override examples = ['<%= config.bin %> <%= command.id %>']
  static override hidden = !isDevelopment()

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
  } {
    return {
      projectConfigStore: new ProjectConfigStore(),
    }
  }

  public async run(): Promise<void> {
    if (!isDevelopment()) {
      this.error('This command is only available in development environment')
    }

    try {
      const {projectConfigStore} = this.createServices()

      // Check if config exists
      const configExists = await projectConfigStore.exists()
      if (!configExists) {
        this.log('No ByteRover config found.')
        this.log('CipherAgent will use the default system prompt.')
        return
      }

      // Read existing config
      const config = await projectConfigStore.read()
      if (!config) {
        this.error('Failed to read config.')
      }

      // Show system prompt
      if (config.cipherAgentSystemPrompt) {
        this.log('Current CipherAgent system prompt:')
        this.log('─'.repeat(60))
        this.log(config.cipherAgentSystemPrompt)
        this.log('─'.repeat(60))
      } else {
        this.log('No custom system prompt configured.')
        this.log('CipherAgent is using the default system prompt.')
      }
    } catch (error) {
      this.error(`Failed to show system prompt: ${getErrorMessage(error)}`)
    }
  }
}
