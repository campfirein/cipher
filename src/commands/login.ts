import {Command} from '@oclif/core'

import type {IAuthService} from '../core/interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../core/interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../core/interfaces/i-callback-handler.js'
import type {IOidcDiscoveryService} from '../core/interfaces/i-oidc-discovery-service.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'
import type {IUserService} from '../core/interfaces/i-user-service.js'

import {getAuthConfig} from '../config/auth.config.js'
import {getCurrentConfig} from '../config/environment.js'
import {AuthToken} from '../core/domain/entities/auth-token.js'
import {DiscoveryError} from '../core/domain/errors/discovery-error.js'
import {ITrackingService} from '../core/interfaces/i-tracking-service.js'
import {OAuthService} from '../infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../infra/auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../infra/browser/system-browser-launcher.js'
import {CallbackHandler} from '../infra/http/callback-handler.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {HttpUserService} from '../infra/user/http-user-service.js'

export default class Login extends Command {
  public static description =
    'Authenticate with ByteRover using OAuth 2.0 + PKCE (opens browser for secure login, stores tokens in keychain)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# After authentication expires, re-login:\n<%= config.bin %> <%= command.id %>',
    '# Check authentication status after login:\n<%= config.bin %> <%= command.id %>\n<%= config.bin %> status',
  ]

  protected async createAuthService(discoveryService: IOidcDiscoveryService): Promise<IAuthService> {
    const config = await getAuthConfig(discoveryService)
    return new OAuthService(config)
  }

  protected createServices(): {
    browserLauncher: IBrowserLauncher
    callbackHandler: ICallbackHandler
    discoveryService: IOidcDiscoveryService
    tokenStore: ITokenStore
    trackingService: ITrackingService
    userService: IUserService
  } {
    const config = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return {
      browserLauncher: new SystemBrowserLauncher(),
      callbackHandler: new CallbackHandler(),
      discoveryService: new OidcDiscoveryService(),
      tokenStore,
      trackingService,
      userService: new HttpUserService({apiBaseUrl: config.apiBaseUrl}),
    }
  }

  public async run(): Promise<void> {
    const {browserLauncher, callbackHandler, discoveryService, tokenStore, trackingService, userService} = this.createServices()

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

      // If browser failed to open, display the URL for manual copy
      if (!browserOpened) {
        this.log('\nBrowser failed to open automatically.')
        this.log('Please open this URL in your browser:')
        this.log(authContext.authUrl)
      }

      try {
        // Wait for callback with 5 minute timeout
        const {code} = await callbackHandler.waitForCallback(authContext.state, 5 * 60 * 1000)
        const authTokenData = await authService.exchangeCodeForToken(code, authContext, redirectUri)
        const user = await userService.getCurrentUser(authTokenData.accessToken, authTokenData.sessionKey)
        const authToken = new AuthToken({
          accessToken: authTokenData.accessToken,
          expiresAt: authTokenData.expiresAt,
          refreshToken: authTokenData.refreshToken,
          sessionKey: authTokenData.sessionKey,
          tokenType: authTokenData.tokenType,
          userEmail: user.email,
          userId: user.id,
        })

        await tokenStore.save(authToken)

        // Track successful authentication
        await trackingService.track('auth:signed_in')

        this.log('Successfully authenticated!')
      } catch (error) {
        // Show clean error without stack trace
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
        process.stderr.write('\n' + errorMessage + '\n\n')
        process.exit(1)
      }
    } catch (error) {
      if (error instanceof DiscoveryError) {
        const errorMessage =
          `Failed to configure authentication: ${error.message}\n` +
          'Please check your network connection and try again.'
        process.stderr.write('\n' + errorMessage + '\n\n')
        process.exit(1)
      }

      // Show clean error without stack trace
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
      process.stderr.write('\n' + errorMessage + '\n\n')
      process.exit(1)
    } finally {
      // Always cleanup server
      await callbackHandler.stop()
    }
  }
}
