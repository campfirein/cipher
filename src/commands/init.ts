import {Command, ux} from '@oclif/core'
import {createInterface} from 'node:readline'

import {getCurrentConfig} from '../config/environment.js'
import {BrConfig} from '../core/domain/entities/br-config.js'
import {InitUseCase} from '../core/usecases/init-use-case.js'
import {FileConfigStore} from '../infra/config/file-config-store.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

export default class Init extends Command {
  public static description = 'Initialize a project with ByteRover'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  public async run(): Promise<void> {
    try {
      // Setup dependencies
      const envConfig = getCurrentConfig()
      const tokenStore = new KeychainTokenStore()
      const spaceService = new HttpSpaceService({
        apiBaseUrl: envConfig.apiBaseUrl,
      })
      const configStore = new FileConfigStore()

      const useCase = new InitUseCase(tokenStore, spaceService, configStore)

      // Check if already initialized
      const isInitialized = await useCase.checkIfInitialized()
      if (isInitialized) {
        this.log('Project is already initialized with ByteRover.')
        this.log('Configuration file: .br/config.json')
        return
      }

      this.log('Initializing ByteRover project...\n')

      // Fetch available spaces
      ux.action.start('Fetching spaces')
      const result = await useCase.fetchSpaces()
      ux.action.stop()

      if (!result.success || !result.spaces) {
        this.error(result.error || 'Failed to fetch spaces')
      }

      // Display spaces and prompt for selection
      this.log(`\nFound ${result.spaces.length} space(s):\n`)

      for (const [index, space] of result.spaces.entries()) {
        const displayName = space.getDisplayName()
        this.log(`  ${index + 1}. ${displayName}`)
      }

      this.log()

      // Prompt user to select a space by number
      const selection = await this.prompt('Select a space by number')

      if (!selection || selection.trim() === '') {
        this.error('Selection is required')
      }

      const selectedIndex = Number.parseInt(selection, 10) - 1
      if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= result.spaces.length) {
        this.error(`Invalid selection: ${selection}`)
      }

      const selectedSpace = result.spaces[selectedIndex]

      // Create and save configuration
      const config = BrConfig.fromSpace(selectedSpace)
      await useCase.saveConfig(config)

      this.log(`\n✓ Project initialized successfully!`)
      this.log(`✓ Connected to space: ${selectedSpace.getDisplayName()}`)
      this.log(`✓ Configuration saved to: .br/config.json`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Initialization failed')
    }
  }

  private async prompt(question: string): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(`${question}: `, (answer) => {
        rl.close()
        resolve(answer)
      })
    })
  }
}
