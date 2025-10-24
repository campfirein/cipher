import {Command} from '@oclif/core'

import type {ISpaceService} from '../core/interfaces/i-space-service.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'

import {getCurrentConfig} from '../config/environment.js'
import {HttpSpaceService} from '../infra/space/http-space-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

export default class Foo extends Command {
  public static description = 'This command is used for interactive testing.'

  public async run(): Promise<void> {
    const envConfig = getCurrentConfig()

    const tokenStore: ITokenStore = new KeychainTokenStore()

    const token = await tokenStore.load()

    if (token === undefined) {
      this.error('No token found in storage.')
    }

    console.log(token)

    const spaceService: ISpaceService = new HttpSpaceService({apiBaseUrl: envConfig.apiBaseUrl})
    const spaces = await spaceService.getSpaces(token.accessToken)
    console.log(spaces)
  }
}
