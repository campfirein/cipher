import {Command} from '@oclif/core'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

export default class Status extends Command {
  public static description =
    'Show CLI status and project information (displays authentication status, current user, project configuration)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Check status after login:\n<%= config.bin %> login\n<%= config.bin %> <%= command.id %>',
    '# Verify project initialization:\n<%= config.bin %> init\n<%= config.bin %> <%= command.id %>',
  ]

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
  } {
    return {
      projectConfigStore: new ProjectConfigStore(),
      tokenStore: new KeychainTokenStore(),
    }
  }

  public async run(): Promise<void> {
    const {projectConfigStore, tokenStore} = this.createServices()

    this.log(`CLI Version: ${this.config.version}`)

    try {
      const token = await tokenStore.load()

      if (token !== undefined && token.isValid()) {
        this.log(`Status: Logged in as ${token.userEmail}`)
      } else if (token === undefined) {
        this.log('Status: Not logged in')
      } else {
        this.log('Status: Session expired (login required)')
      }
    } catch (error) {
      this.log('Status: Unable to check authentication status')
      this.warn(`Warning: ${(error as Error).message}`)
    }

    const cwd = process.cwd()
    this.log(`Current Directory: ${cwd}`)

    try {
      const isInitialized = await projectConfigStore.exists()

      if (isInitialized) {
        const config = await projectConfigStore.read()
        if (config) {
          this.log(`Project Status: Connected to ${config.teamName}/${config.spaceName}`)
        } else {
          this.log('Project Status: Configuration file exists but is invalid')
        }
      } else {
        this.log('Project Status: Not initialized')
      }
    } catch (error) {
      this.log('Project Status: Unable to read project configuration')
      this.warn(`Warning: ${(error as Error).message}`)
    }
  }
}
