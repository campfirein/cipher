import {getAuthConfig} from '../../config/auth.config.js'
import {getCurrentConfig} from '../../config/environment.js'
import {OAuthService} from '../../infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../../infra/auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../../infra/browser/system-browser-launcher.js'
import {CallbackHandler} from '../../infra/http/callback-handler.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {ReplTerminal} from '../../infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {LoginUseCase} from '../../infra/usecase/login-use-case.js'
import {HttpUserService} from '../../infra/user/http-user-service.js'
import {CommandKind, SlashCommand} from '../types.js'

/**
 * Login command
 *
 * Creates and runs LoginUseCase with ReplTerminal for TUI integration.
 */
export const loginCommand: SlashCommand = {
  action: () => ({
    async execute(onMessage, onPrompt) {
      // Create ReplTerminal with callbacks
      const terminal = new ReplTerminal({onMessage, onPrompt})

      // Create services
      const config = getCurrentConfig()
      const tokenStore = createTokenStore()
      const globalConfigStore = new FileGlobalConfigStore()
      const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
      const discoveryService = new OidcDiscoveryService()
      const authConfig = await getAuthConfig(discoveryService)

      // Create and run LoginUseCase
      const useCase = new LoginUseCase({
        authService: new OAuthService(authConfig),
        browserLauncher: new SystemBrowserLauncher(),
        callbackHandler: new CallbackHandler(),
        terminal,
        tokenStore,
        trackingService,
        userService: new HttpUserService({apiBaseUrl: config.apiBaseUrl}),
      })

      await useCase.run()
    },
    type: 'streaming',
  }),
  aliases: [],
  autoExecute: true,
  description: 'Authenticate with ByteRover using OAuth 2.0 + PKCE',
  kind: CommandKind.BUILT_IN,
  name: 'login',
}
