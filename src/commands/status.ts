import {Command} from '@oclif/core'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'
import type {IUserService} from '../core/interfaces/i-user-service.js'

import {getCurrentConfig} from '../config/environment.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {HttpUserService} from '../infra/user/http-user-service.js'

export default class Status extends Command {
  public static description = 'Show CLI status and project information (displays authentication status, current user, project configuration)'
public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Check status after login:\n<%= config.bin %> login\n<%= config.bin %> <%= command.id %>',
    '# Verify project initialization:\n<%= config.bin %> init\n<%= config.bin %> <%= command.id %>',
  ]

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
    tokenStore: ITokenStore
    userService: IUserService
  } {
    const envConfig = getCurrentConfig()
    return {
      projectConfigStore: new ProjectConfigStore(),
      tokenStore: new KeychainTokenStore(),
      userService: new HttpUserService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
    }
  }

  public async run(): Promise<void> {
    const {projectConfigStore, tokenStore, userService} = this.createServices()

    // 1. Show CLI Version
    this.log(`CLI Version: ${this.config.version}`)

    // 2. Show Login Status
    try {
      const token = await tokenStore.load()

      if (token !== undefined && token.isValid()) {
        try {
          const user = await userService.getCurrentUser(token.accessToken, token.sessionKey)
          this.log(`Status: Logged in as ${user.email}`)
        } catch (error) {
          // If we can't fetch user info, still show we have a valid token
          this.log('Status: Logged in (unable to fetch user information)')
          this.warn(`Warning: ${(error as Error).message}`)
        }
      } else if (token === undefined) {
        this.log('Status: Not logged in')
      } else {
        this.log('Status: Session expired (login required)')
      }
    } catch (error) {
      this.log('Status: Unable to check authentication status')
      this.warn(`Warning: ${(error as Error).message}`)
    }

    // 3. Show Current Directory
    const cwd = process.cwd()
    this.log(`Current Directory: ${cwd}`)

    // 4. Show Project Status
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
