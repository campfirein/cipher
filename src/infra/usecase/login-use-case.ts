import type {IAuthService} from '../../core/interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../../core/interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../../core/interfaces/i-callback-handler.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IUserService} from '../../core/interfaces/i-user-service.js'
import type {ILoginUseCase} from '../../core/interfaces/usecase/i-login-use-case.js'

import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {DiscoveryError} from '../../core/domain/errors/discovery-error.js'

export interface LoginUseCaseOptions {
  authService: IAuthService
  browserLauncher: IBrowserLauncher
  callbackHandler: ICallbackHandler
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
  userService: IUserService
}

export class LoginUseCase implements ILoginUseCase {
  private readonly authService: IAuthService
  private readonly browserLauncher: IBrowserLauncher
  private readonly callbackHandler: ICallbackHandler
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly userService: IUserService

  constructor(options: LoginUseCaseOptions) {
    this.authService = options.authService
    this.browserLauncher = options.browserLauncher
    this.callbackHandler = options.callbackHandler
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
    this.userService = options.userService
  }

  public async run(): Promise<void> {
    try {
      this.terminal.log('Starting authentication process...')

      // Start callback server
      await this.callbackHandler.start()

      // Get port and build redirect URI
      const port = this.callbackHandler.getPort()
      if (!port) {
        throw new Error('Failed to get callback server port')
      }

      const redirectUri = `http://localhost:${port}/callback`

      // Initiate authorization (generates PKCE parameters and state internally)
      const authContext = this.authService.initiateAuthorization(redirectUri)

      // Try to open browser
      let browserOpened = false
      try {
        await this.browserLauncher.open(authContext.authUrl)
        browserOpened = true
      } catch {
        // Browser launch failed, will return URL to user
      }

      // If browser failed to open, display the URL for manual copy
      if (!browserOpened) {
        this.terminal.log('\nBrowser failed to open automatically.')
        this.terminal.log('Please open this URL in your browser:')
        this.terminal.log(authContext.authUrl)
      }

      try {
        // Wait for callback with 5 minute timeout
        const {code} = await this.callbackHandler.waitForCallback(authContext.state, 5 * 60 * 1000)
        const authTokenData = await this.authService.exchangeCodeForToken(code, authContext, redirectUri)
        const user = await this.userService.getCurrentUser(authTokenData.accessToken, authTokenData.sessionKey)
        const authToken = new AuthToken({
          accessToken: authTokenData.accessToken,
          expiresAt: authTokenData.expiresAt,
          refreshToken: authTokenData.refreshToken,
          sessionKey: authTokenData.sessionKey,
          tokenType: authTokenData.tokenType,
          userEmail: user.email,
          userId: user.id,
        })

        await this.tokenStore.save(authToken)

        // Track successful authentication
        await this.trackingService.track('auth:signed_in')

        this.terminal.log('Successfully authenticated!')
      } catch (error) {
        // Throw error to let oclif handle display
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
        this.terminal.error(errorMessage)
      }
    } catch (error) {
      if (error instanceof DiscoveryError) {
        const errorMessage =
          `Failed to configure authentication: ${error.message}\n` +
          'Please check your network connection and try again.'
        this.terminal.error(errorMessage)
      }

      // Throw error to let oclif handle display
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
      this.terminal.error(errorMessage)
    } finally {
      // Always cleanup server
      await this.callbackHandler.stop()
    }
  }
}
