import {Command} from '@oclif/core'

import {ProjectConfigStore} from '../../infra/config/file-config-store.js'

export default class CipherAgentShowPrompt extends Command {
  static override description = 'Show the current CipherAgent system prompt'
  static override examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const configStore = new ProjectConfigStore()

      // Check if config exists
      const configExists = await configStore.exists()
      if (!configExists) {
        this.log('No ByteRover config found.')
        this.log('CipherAgent will use the default system prompt.')
        return
      }

      // Read existing config
      const config = await configStore.read()
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
      this.error(`Failed to show system prompt: ${(error as Error).message}`)
    }
  }
}
