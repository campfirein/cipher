import {Command, ux} from '@oclif/core'
import {createInterface} from 'node:readline'

import type {Space} from '../core/domain/entities/space.js'
import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../core/interfaces/i-space-service.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {BrConfig} from '../core/domain/entities/br-config.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

export default class Init extends Command {
  public static description = 'Initialize a project with ByteRover'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
    spaceService: ISpaceService
    tokenStore: ITokenStore
  } {
    const envConfig = getCurrentConfig()
    return {
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      tokenStore: new KeychainTokenStore(),
    }
  }

  protected async promptForSpaceSelection(spaces: Space[]): Promise<Space> {
    const selection = await this.promptUser('Select a space by number')

    if (!selection || selection.trim() === '') {
      this.error('Selection is required')
    }

    const selectedIndex = Number.parseInt(selection, 10) - 1

    if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= spaces.length) {
      this.error(`Invalid selection: ${selection}`)
    }

    return spaces[selectedIndex]
  }

  protected async promptUser(question: string): Promise<string> {
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

  public async run(): Promise<void> {
    try {
      const {projectConfigStore, spaceService, tokenStore} = this.createServices()

      // 1. Check if already initialized
      const isInitialized = await projectConfigStore.exists()
      if (isInitialized) {
        this.log('Project is already initialized with ByteRover.')
        const existingProjectConfig = await projectConfigStore.read()
        this.log(
          `Your space for this project is: ${existingProjectConfig?.teamName}/${existingProjectConfig?.spaceName}`,
        )
        return
      }

      this.log('Initializing ByteRover project...\n')

      // 2. Load and validate authentication token
      const token = await tokenStore.load()
      if (token === undefined) {
        this.error('Not authenticated. Please run "br auth login" first.')
      }

      if (!token.isValid()) {
        this.error('Authentication token expired. Please run "br auth login" again.')
      }

      // 3. Fetch spaces with spinner
      ux.action.start('Fetching spaces')
      const spaces = await spaceService.getSpaces(token.accessToken, token.sessionKey)
      ux.action.stop()

      if (spaces.length === 0) {
        this.error('No spaces found. Please create a space in the ByteRover dashboard first.')
      }

      // 4. Display spaces
      this.log(`\nFound ${spaces.length} space(s):\n`)
      for (const [index, space] of spaces.entries()) {
        const displayName = space.getDisplayName()
        this.log(`  ${index + 1}. ${displayName}`)
      }

      this.log()

      // 5. Prompt for selection
      const selectedSpace = await this.promptForSpaceSelection(spaces)

      // 6. Create and save configuration
      const config = BrConfig.fromSpace(selectedSpace)
      await projectConfigStore.write(config)

      // 7. Display success
      this.log(`\n✓ Project initialized successfully!`)
      this.log(`✓ Connected to space: ${selectedSpace.getDisplayName()}`)
      this.log(`✓ Configuration saved to: .br/config.json`)
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Initialization failed')
    }
  }
}
