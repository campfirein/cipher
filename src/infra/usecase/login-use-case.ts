import type {IAuthService} from '../../core/interfaces/i-auth-service.js'
import type {IBrowserLauncher} from '../../core/interfaces/i-browser-launcher.js'
import type {ICallbackHandler} from '../../core/interfaces/i-callback-handler.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../core/interfaces/i-space-service.js'
import type {ITeamService} from '../../core/interfaces/i-team-service.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IUserService} from '../../core/interfaces/i-user-service.js'
import type {ILoginUseCase} from '../../core/interfaces/usecase/i-login-use-case.js'

import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {DiscoveryError} from '../../core/domain/errors/discovery-error.js'

export interface LoginUseCaseOptions {
  authService: IAuthService
  browserLauncher: IBrowserLauncher
  callbackHandler: ICallbackHandler
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  teamService: ITeamService
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
  userService: IUserService
}

export class LoginUseCase implements ILoginUseCase {
  private readonly authService: IAuthService
  private readonly browserLauncher: IBrowserLauncher
  private readonly callbackHandler: ICallbackHandler
  private readonly projectConfigStore: IProjectConfigStore
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly userService: IUserService

  constructor(options: LoginUseCaseOptions) {
    this.authService = options.authService
    this.browserLauncher = options.browserLauncher
    this.callbackHandler = options.callbackHandler
    this.projectConfigStore = options.projectConfigStore
    this.spaceService = options.spaceService
    this.teamService = options.teamService
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
    this.userService = options.userService
  }

  public async run(): Promise<void> {
    try {
      await this.trackingService.track('auth:sign_in', {status: 'started'})
      this.terminal.log('Starting authentication process...')

      // Start callback server
      await this.callbackHandler.start()

      // Get port and build redirect URI
      const port = this.callbackHandler.getPort()
      if (!port) {
        const getPortFailedErr = 'Failed to get callback server port'
        await this.trackingService.track('auth:sign_in', {message: getPortFailedErr, status: 'error'})
        throw new Error(getPortFailedErr)
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
        await this.trackingService.track('auth:sign_in', {message: 'browser launch failed', status: 'error'})
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
        await this.trackingService.track('auth:sign_in', {status: 'finished'})
        this.terminal.log(`Logged in as ${user.email}`)
        await this.preSelectTeamAndSpace(authToken)
      } catch (error) {
        // Throw error to let oclif handle display
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
        await this.trackingService.track('auth:sign_in', {message: errorMessage, status: 'error'})
        this.terminal.error(errorMessage)
      }
    } catch (error) {
      if (error instanceof DiscoveryError) {
        const errorMessage =
          `Failed to configure authentication: ${error.message}\n` +
          'Please check your network connection and try again.'
        await this.trackingService.track('auth:sign_in', {message: errorMessage, status: 'error'})
        this.terminal.error(errorMessage)
      }

      // Throw error to let oclif handle display
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
      await this.trackingService.track('auth:sign_in', {message: errorMessage, status: 'error'})
      this.terminal.error(errorMessage)
    } finally {
      // Always cleanup server
      await this.callbackHandler.stop()
    }
  }

  /**
   * Pre-select team and space if user has only one of each.
   */
  private async preSelectTeamAndSpace(authToken: AuthToken): Promise<void> {
    try {
      // Fetch all teams
      const {teams} = await this.teamService.getTeams(authToken.accessToken, authToken.sessionKey, { fetchAll: true })

      if (teams.length !== 1) return

      const team = teams[0]

      // Fetch spaces for the single team
      const {spaces} = await this.spaceService.getSpaces(authToken.accessToken, authToken.sessionKey, team.id, {
        fetchAll: true,
      })

      if (spaces.length !== 1) return

      const space = spaces[0]

      // Save partial config (without chatLogPath, cwd, ide - those are set in /init)
      const config = BrvConfig.partialFromSpace({space})
      await this.projectConfigStore.write(config)

      // User has exactly one team and one space - inform them
      this.terminal.log(`\nReady to use: ${space.getDisplayName()}`)
    } catch {
      // Silently ignore errors - pre-selection is optional
    }
  }
}
