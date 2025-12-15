import {Args, Command} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'

import {isDevelopment} from '../../config/environment.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {getErrorMessage} from '../../utils/error-helpers.js'

export default class CipherAgentSetPrompt extends Command {
  static override args = {
    prompt: Args.string({description: 'The system prompt for CipherAgent', required: true}),
  }
  static override description = 'Set custom system prompt for CipherAgent [Development only]'
  static override examples = [
    '<%= config.bin %> <%= command.id %> "You are a helpful coding assistant specialized in TypeScript"',
    '<%= config.bin %> <%= command.id %> "You are an expert in refactoring and code quality improvements"',
  ]
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

    const {args} = await this.parse(CipherAgentSetPrompt)

    try {
      // Check if config exists
      const configExists = await projectConfigStore.exists()
      if (!configExists) {
        this.terminal.error('No ByteRover config found. Please run "byterover init" first to initialize the project.')
      }

      // Read existing config
      const existingConfig = await projectConfigStore.read()
      if (!existingConfig) {
        this.terminal.error('Failed to read existing config.')
        return
      }

      // Create updated config with new system prompt
      const updatedConfig = new BrvConfig({
        ...existingConfig,
        cipherAgentSystemPrompt: args.prompt,
      })

      // Write updated config
      await projectConfigStore.write(updatedConfig)

      this.terminal.log('✓ CipherAgent system prompt updated successfully!')
      this.terminal.log('\nNew prompt:')
      this.terminal.log(args.prompt)
    } catch (error) {
      this.terminal.error(`Failed to set system prompt: ${getErrorMessage(error)}`)
    }
  }
}
