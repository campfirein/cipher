import {Command} from '@oclif/core'

import type {IAuthService} from '../../core/interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../../core/interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../../core/interfaces/i-callback-handler.js'
import type {IOidcDiscoveryService} from '../../core/interfaces/i-oidc-discovery-service.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getAuthConfig} from '../../config/auth.config.js'
import {DiscoveryError} from '../../core/domain/errors/discovery-error.js'
import {OAuthService} from '../../infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../../infra/auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../../infra/browser/system-browser-launcher.js'
import {CallbackHandler} from '../../infra/http/callback-handler.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'

export default class Login extends Command {
  public static description = 'Authenticate with ByteRover'

  protected async createAuthService(discoveryService: IOidcDiscoveryService): Promise<IAuthService> {
    const config = await getAuthConfig(discoveryService)
    return new OAuthService(config)
  }

  protected createServices(): {
    browserLauncher: IBrowserLauncher
    callbackHandler: ICallbackHandler
    discoveryService: IOidcDiscoveryService
    tokenStore: ITokenStore
  } {
    return {
      browserLauncher: new SystemBrowserLauncher(),
      callbackHandler: new CallbackHandler(),
      discoveryService: new OidcDiscoveryService(),
      tokenStore: new KeychainTokenStore(),
    }
  }

  public async run(): Promise<void> {
    const {browserLauncher, callbackHandler, discoveryService, tokenStore} = this.createServices()

    try {
      this.log('Starting authentication process...')

      // Create auth service with discovered config
      const authService = await this.createAuthService(discoveryService)

      // Start callback server
      await callbackHandler.start()

      // Get port and build redirect URI
      const port = callbackHandler.getPort()
      if (!port) {
        throw new Error('Failed to get callback server port')
      }

      const redirectUri = `http://localhost:${port}/callback`

      // Initiate authorization (generates PKCE parameters and state internally)
      const authContext = authService.initiateAuthorization(redirectUri)

      // Try to open browser
      let browserOpened = false
      try {
        await browserLauncher.open(authContext.authUrl)
        browserOpened = true
      } catch {
        // Browser launch failed, will return URL to user
      }

      try {
        // Wait for callback with 5 minute timeout
        const {code} = await callbackHandler.waitForCallback(authContext.state, 5 * 60 * 1000)

        // Exchange code for token
        const token = await authService.exchangeCodeForToken(code, authContext, redirectUri)

        // Store token
        await tokenStore.save(token)

        this.log('Successfully authenticated!')

        // If browser failed to open, display the URL for manual copy
        if (!browserOpened) {
          this.log('\nBrowser failed to open automatically.')
          this.log('Please open this URL in your browser:')
          this.log(authContext.authUrl)
        }
      } catch (error) {
        this.error(error instanceof Error ? error.message : 'Authentication failed')
      }
    } catch (error) {
      if (error instanceof DiscoveryError) {
        this.error(
          `Failed to configure authentication: ${error.message}\n` +
            'Please check your network connection and try again.',
        )
      }

      this.error(error instanceof Error ? error.message : 'Authentication failed')
    } finally {
      // Always cleanup server
      await callbackHandler.stop()
    }
  }
}
