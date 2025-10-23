import {Command} from '@oclif/core'

import {getAuthConfig} from '../../config/auth.config.js'
import {DiscoveryError} from '../../core/domain/errors/discovery-error.js'
import {LoginUseCase} from '../../core/usecases/login-use-case.js'
import {OAuthService} from '../../infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../../infra/auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../../infra/browser/system-browser-launcher.js'
import {CallbackHandler} from '../../infra/http/callback-handler.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'

export default class Login extends Command {
  public static description = 'Authenticate with ByteRover'

  public async run(): Promise<void> {
    try {
      // Initialize OIDC discovery service
      const discoveryService = new OidcDiscoveryService()

      // Get configuration (with discovery)
      const config = await getAuthConfig(discoveryService)

      // Setup dependencies
      const authService = new OAuthService(config)
      const tokenStore = new KeychainTokenStore()
      const browserLauncher = new SystemBrowserLauncher()
      const callbackHandler = new CallbackHandler()

      const useCase = new LoginUseCase(authService, browserLauncher, tokenStore, callbackHandler)

      this.log('Starting authentication process...')

      // Execute login
      const result = await useCase.execute()

      if (result.success) {
        this.log('Successfully authenticated!')

        // If browser failed to open, display the URL for manual copy
        if (result.authUrl) {
          this.log('\nBrowser failed to open automatically.')
          this.log('Please open this URL in your browser:')
          this.log(result.authUrl)
        }
      } else {
        this.error(result.error || 'Authentication failed')
      }
    } catch (error) {
      if (error instanceof DiscoveryError) {
        this.error(
          `Failed to configure authentication: ${error.message}\n` +
            'Please check your network connection and try again.',
        )
      }

      this.error(error instanceof Error ? error.message : 'Authentication failed')
    }
  }
}
