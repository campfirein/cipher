import {Command} from '@oclif/core'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'

export default class Main extends Command {
  public static description = 'ByteRover CLI'
  /**
   *  Hide from help listing since this is the default command (only 'brv')
   */
  public static hidden = true
  protected terminal: ITerminal = {} as ITerminal

  protected createServices(): {projectConfigStore: IProjectConfigStore; tokenStore: ITokenStore} {
    this.terminal = new OclifTerminal(this)
    const tokenStore: ITokenStore = new KeychainTokenStore()
    const projectConfigStore: IProjectConfigStore = new ProjectConfigStore()
    return {projectConfigStore, tokenStore}
  }

  public async run(): Promise<void> {
    const {projectConfigStore, tokenStore} = this.createServices()
    const authToken = await tokenStore.load()
    if (authToken !== undefined && authToken.isValid()) {
      this.terminal.log(`Logged in as ${authToken.userEmail}`)
      const projectConfigExistsInCwd = await projectConfigStore.exists()
      if (projectConfigExistsInCwd) {
        this.terminal.log('')
        this.terminal.log('Project configuration found in the current directory:')
        this.terminal.log(`${process.cwd()}`)
        this.terminal.log("You can always run 'brv init' to re-initialize ByteRover for this project.")
        this.terminal.log("Then run 'brv' again.")
      } else {
        this.terminal.log('')
        this.terminal.log('No project configuration found in the current directory.')
        this.terminal.log('Please ensure you are in your desired codebase directory.')
        this.terminal.log("Run 'brv init' to initialize ByteRover for this project.")
        this.terminal.log("Then run 'brv' again.")
      }
    } else if (authToken === undefined) {
      this.terminal.log('You are not currently logged in.')
      this.terminal.log("Run 'brv login' to authenticate.")
      this.terminal.log("Then run 'brv' again.")
    } else {
      this.terminal.log('Session expired.')
      this.terminal.log("Run 'brv login' to authenticate.")
      this.terminal.log("Then run 'brv' again.")
    }
  }
}
