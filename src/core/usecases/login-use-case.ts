import type {AuthToken} from '../domain/entities/auth-token.js'
import type {IAuthService} from '../interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../interfaces/i-callback-handler.js'
import type {ITokenStore} from '../interfaces/i-token-store.js'

type LoginResult = {
  authUrl?: string
  error?: string
  success: boolean
  token?: AuthToken
}

/**
 * Use case for handling user login via OAuth 2.0 + PKCE flow.
 * Manages the complete authentication flow including server lifecycle.
 */
export class LoginUseCase {
  private readonly authService: IAuthService
  private readonly browserLauncher: IBrowserLauncher
  private readonly callbackHandler: ICallbackHandler
  private readonly tokenStore: ITokenStore

  public constructor(
    authService: IAuthService,
    browserLauncher: IBrowserLauncher,
    tokenStore: ITokenStore,
    callbackHandler: ICallbackHandler,
  ) {
    this.authService = authService
    this.browserLauncher = browserLauncher
    this.tokenStore = tokenStore
    this.callbackHandler = callbackHandler
  }

  public async execute(): Promise<LoginResult> {
    try {
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

      try {
        // Wait for callback with 5 minute timeout
        const {code} = await this.callbackHandler.waitForCallback(authContext.state, 5 * 60 * 1000)

        // Exchange code for token
        const token = await this.authService.exchangeCodeForToken(code, authContext, redirectUri)

        // Store token
        await this.tokenStore.save(token)

        return {
          authUrl: browserOpened ? undefined : authContext.authUrl,
          success: true,
          token,
        }
      } catch (error) {
        return {
          authUrl: browserOpened ? undefined : authContext.authUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false,
        }
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      }
    } finally {
      // Always cleanup server
      await this.callbackHandler.stop()
    }
  }
}
