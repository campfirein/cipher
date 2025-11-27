import {Args, Command} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'

import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'

export default class CipherAgentSetPrompt extends Command {
  static override args = {
    prompt: Args.string({description: 'The system prompt for CipherAgent', required: true}),
  }
  static override description = 'Set custom system prompt for CipherAgent'
  static override examples = [
    '<%= config.bin %> <%= command.id %> "You are a helpful coding assistant specialized in TypeScript"',
    '<%= config.bin %> <%= command.id %> "You are an expert in refactoring and code quality improvements"',
  ]

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
  } {
    return {
      projectConfigStore: new ProjectConfigStore(),
    }
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(CipherAgentSetPrompt)

    try {
      const {projectConfigStore} = this.createServices()

      // Check if config exists
      const configExists = await projectConfigStore.exists()
      if (!configExists) {
        this.error(
          'No ByteRover config found. Please run "byterover init" first to initialize the project.',
        )
      }

      // Read existing config
      const existingConfig = await projectConfigStore.read()
      if (!existingConfig) {
        this.error('Failed to read existing config.')
      }

      // Create updated config with new system prompt
      const updatedConfig = new BrvConfig({
        ...existingConfig,
        cipherAgentSystemPrompt: args.prompt,
      })

      // Write updated config
      await projectConfigStore.write(updatedConfig)

      this.log('✓ CipherAgent system prompt updated successfully!')
      this.log('\nNew prompt:')
      this.log(args.prompt)
    } catch (error) {
      this.error(`Failed to set system prompt: ${(error as Error).message}`)
    }
  }
}
