import crypto from 'node:crypto'

import type {AuthToken} from '../domain/entities/auth-token.js'
import type {IAuthService} from '../interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../interfaces/i-browser-launcher.js'
import type {ITokenStore} from '../interfaces/i-token-store.js'

type LoginResult = {
  authUrl?: string
  error?: string
  success: boolean
  token?: AuthToken
}

type CallbackFn = () => Promise<{code: string; state: string}>

export class LoginUseCase {
  private readonly authService: IAuthService
  private readonly browserLauncher: IBrowserLauncher
  private readonly tokenStore: ITokenStore

  public constructor(authService: IAuthService, browserLauncher: IBrowserLauncher, tokenStore: ITokenStore) {
    this.authService = authService
    this.browserLauncher = browserLauncher
    this.tokenStore = tokenStore
  }

  public async execute(getCallback: CallbackFn): Promise<LoginResult> {
    // Generate PKCE parameters
    const codeVerifier = this.generateCodeVerifier()
    const state = this.generateState()

    // Build authorization URL
    const authUrl = this.authService.buildAuthorizationUrl(state, codeVerifier)

    // Try to open browser
    let browserOpened = false
    try {
      await this.browserLauncher.open(authUrl)
      browserOpened = true
    } catch {
      // Browser launch failed, will return URL to user
    }

    try {
      // Wait for callback
      const {code} = await getCallback()

      // Exchange code for token
      const token = await this.authService.exchangeCodeForToken(code, codeVerifier)

      // // Store token
      await this.tokenStore.save(token)

      return {
        success: true,
        token,
      }
    } catch (error) {
      return {
        authUrl: browserOpened ? undefined : authUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      }
    }
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  private generateState(): string {
    return crypto.randomBytes(16).toString('base64url')
  }
}
