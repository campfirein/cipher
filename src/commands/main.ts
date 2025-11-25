import {Command} from '@oclif/core'

import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

export default class Main extends Command {
  public static description = 'ByteRover CLI'
  /**
   *  Hide from help listing since this is the default command (only 'brv')
   */
  public static hidden = true

  protected createServices(): {tokenStore: ITokenStore} {
    const tokenStore: ITokenStore = new KeychainTokenStore()
    return {tokenStore}
  }

  public async run(): Promise<void> {
    const {tokenStore} = this.createServices()
    const authToken = await tokenStore.load()
    if (authToken !== undefined && authToken.isValid()) {
      this.log(`Logged in as ${authToken.userEmail}`)
    } else if (authToken === undefined) {
      this.log('You are not currently logged in.')
      this.log("Run 'brv login' to authenticate.")
    } else {
      this.log('Session expired.')
      this.log("Run 'brv login' to authenticate.")
    }
  }
}
