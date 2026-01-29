import {Command, Flags} from '@oclif/core'

import {getAuthConfig} from '../../config/auth.config.js'
import {getCurrentConfig} from '../../config/environment.js'
import {OAuthService} from '../../infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../../infra/auth/oidc-discovery-service.js'
import {SystemBrowserLauncher} from '../../infra/browser/system-browser-launcher.js'
import {CallbackHandler} from '../../infra/http/callback-handler.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {OclifTerminal} from '../../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {LoginUseCase} from '../../infra/usecase/login-use-case.js'
import {HttpUserService} from '../../infra/user/http-user-service.js'

export default class Login extends Command {
  public static description = 'Authenticate with ByteRover using an API key'
  public static examples = ['<%= config.bin %> <%= command.id %> --api-key <key>']
  public static flags = {
    'api-key': Flags.string({
      char: 'k',
      description: 'API key for authentication (get yours at https://app.byterover.dev/settings/keys)',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Login)
    const apiKey = flags['api-key']

    const config = getCurrentConfig()
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
    const terminal = new OclifTerminal(this)
    const discoveryService = new OidcDiscoveryService()
    const authConfig = await getAuthConfig(discoveryService)

    const useCase = new LoginUseCase({
      authService: new OAuthService(authConfig),
      browserLauncher: new SystemBrowserLauncher(),
      callbackHandler: new CallbackHandler(),
      terminal,
      tokenStore,
      trackingService,
      userService: new HttpUserService({apiBaseUrl: config.apiBaseUrl}),
    })

    await useCase.run({apiKey})
  }
}
