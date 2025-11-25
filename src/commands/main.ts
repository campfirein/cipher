import {Command} from '@oclif/core'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

export default class Main extends Command {
  public static description = 'ByteRover CLI'
  /**
   *  Hide from help listing since this is the default command (only 'brv')
   */
  public static hidden = true

  protected createServices(): {projectConfigStore: IProjectConfigStore; tokenStore: ITokenStore} {
    const tokenStore: ITokenStore = new KeychainTokenStore()
    const projectConfigStore: IProjectConfigStore = new ProjectConfigStore()
    return {projectConfigStore, tokenStore}
  }

  public async run(): Promise<void> {
    const {projectConfigStore, tokenStore} = this.createServices()
    const authToken = await tokenStore.load()
    if (authToken !== undefined && authToken.isValid()) {
      this.log(`Logged in as ${authToken.userEmail}`)
      const projectConfigExistsInCwd = await projectConfigStore.exists()
      if (projectConfigExistsInCwd) {
        this.log('')
        this.log('Project configuration found in the current directory:')
        this.log(`${process.cwd()}`)
        this.log("You can always run 'brv init' to re-initialize ByteRover for this project.")
        this.log("Then run 'brv' again.")
      } else {
        this.log('')
        this.log('No project configuration found in the current directory.')
        this.log('Please ensure you are in your desired codebase directory.')
        this.log("Run 'brv init' to initialize ByteRover for this project.")
        this.log("Then run 'brv' again.")
      }
    } else if (authToken === undefined) {
      this.log('You are not currently logged in.')
      this.log("Run 'brv login' to authenticate.")
      this.log("Then run 'brv' again.")
    } else {
      this.log('Session expired.')
      this.log("Run 'brv login' to authenticate.")
      this.log("Then run 'brv' again.")
    }
  }
}
