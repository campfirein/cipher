import { getAuthConfig } from '../../../config/auth.config.js'
import { getCurrentConfig } from '../../../config/environment.js'
import { CommandKind, SlashCommand } from '../../../tui/types.js'
import { OAuthService } from '../../auth/oauth-service.js'
import { OidcDiscoveryService } from '../../auth/oidc-discovery-service.js'
import { SystemBrowserLauncher } from '../../browser/system-browser-launcher.js'
import { ProjectConfigStore } from '../../config/file-config-store.js'
import { CallbackHandler } from '../../http/callback-handler.js'
import { HttpSpaceService } from '../../space/http-space-service.js'
import {FileGlobalConfigStore} from "../../storage/file-global-config-store.js";
import { createTokenStore } from '../../storage/token-store.js'
import { HttpTeamService } from '../../team/http-team-service.js'
import { ReplTerminal } from '../../terminal/repl-terminal.js'
import { MixpanelTrackingService } from '../../tracking/mixpanel-tracking-service.js'
import { LoginUseCase } from '../../usecase/login-use-case.js'
import { HttpUserService } from '../../user/http-user-service.js'

/**
 * Login command
 *
 * Creates and runs LoginUseCase with ReplTerminal for TUI integration.
 */
export const loginCommand: SlashCommand = {
  action: () => ({
    async execute(onMessage, onPrompt) {
      // Create ReplTerminal with callbacks
      const terminal = new ReplTerminal({ onMessage, onPrompt })

      // Create services
      const config = getCurrentConfig()
      const tokenStore = createTokenStore()
      const globalConfigStore = new FileGlobalConfigStore()
      const projectConfigStore = new ProjectConfigStore()
      const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
      const discoveryService = new OidcDiscoveryService()
      const authConfig = await getAuthConfig(discoveryService)

      // Create and run LoginUseCase
      const useCase = new LoginUseCase({
        authService: new OAuthService(authConfig),
        browserLauncher: new SystemBrowserLauncher(),
        callbackHandler: new CallbackHandler(),
        projectConfigStore,
        spaceService: new HttpSpaceService({ apiBaseUrl: config.apiBaseUrl }),
        teamService: new HttpTeamService({ apiBaseUrl: config.apiBaseUrl }),
        terminal,
        tokenStore,
        trackingService,
        userService: new HttpUserService({ apiBaseUrl: config.apiBaseUrl }),
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
