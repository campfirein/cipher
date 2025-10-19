import {Command, ux} from '@oclif/core'

import {getAuthConfig} from '../../config/auth.config.js'
import {LoginUseCase} from '../../core/usecases/login-use-case.js'
import {OAuthService} from '../../infra/auth/oauth-service.js'
import {SystemBrowserLauncher} from '../../infra/browser/system-browser-launcher.js'
import {CallbackServer} from '../../infra/http/callback-server.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'

export default class Login extends Command {
  public static description = 'Authenticate with ByteRover'

  public async run(): Promise<void> {
    try {
      // Setup dependencies
      const config = getAuthConfig()
      const authService = new OAuthService(config)
      const tokenStore = new KeychainTokenStore()
      const browserLauncher = new SystemBrowserLauncher()

      const useCase = new LoginUseCase(authService, browserLauncher, tokenStore)

      // Start callback server
      const callbackServer = new CallbackServer()
      const port = await callbackServer.start()
      console.log(port)

      // Update config with actual port
      config.redirectUri = `http://localhost:${port}/auth/callback`

      ux.action.start('Waiting for authentication')

      // Execute login
      const result = await useCase.execute(async () => {
        const state = Math.random().toString(36).slice(2)
        return callbackServer.waitForCallback(state, 5000)
      })

      ux.action.stop()

      await callbackServer.stop()

      if (result.success) {
        this.log('Successfully authenticated!')
      } else {
        this.log('Authentication failed.')
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Authentication failed')
    }
  }
}
