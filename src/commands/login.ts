import {Command} from '@oclif/core'

import type {ILoginUseCase} from '../core/interfaces/usecase/i-login-use-case.js'

import {getAuthConfig} from '../config/auth.config.js'
import {getCurrentConfig} from '../config/environment.js'
import {OAuthService} from '../infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../infra/auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../infra/browser/system-browser-launcher.js'
import {CallbackHandler} from '../infra/http/callback-handler.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {LoginUseCase} from '../infra/usecase/login-use-case.js'
import {HttpUserService} from '../infra/user/http-user-service.js'

export default class Login extends Command {
  public static description =
    'Authenticate with ByteRover using OAuth 2.0 + PKCE (opens browser for secure login, stores tokens in keychain)'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# After authentication expires, re-login:\n<%= config.bin %> <%= command.id %>',
    '# Check authentication status after login:\n<%= config.bin %> <%= command.id %>\n<%= config.bin %> status',
  ]

  protected async createUseCase(): Promise<ILoginUseCase> {
    const config = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)
    const discoveryService = new OidcDiscoveryService()
    const authConfig = await getAuthConfig(discoveryService)

    return new LoginUseCase({
      authService: new OAuthService(authConfig),
      browserLauncher: new SystemBrowserLauncher(),
      callbackHandler: new CallbackHandler(),
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService,
      userService: new HttpUserService({apiBaseUrl: config.apiBaseUrl}),
    })
  }

  public async run(): Promise<void> {
    await (await this.createUseCase()).run()
  }
}
