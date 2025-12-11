import {Command, Flags} from '@oclif/core'

import type {ITerminal} from '../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

export default class Logout extends Command {
  public static description = 'Log out of ByteRover CLI and clear authentication (does not affect local project files)'
  public static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --yes']
  public static flags = {
    yes: Flags.boolean({
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
    }),
  }
  protected terminal: ITerminal = {} as ITerminal

  protected async confirmLogout(userEmail: string): Promise<boolean> {
    return this.terminal.confirm({
      // Pressing 'Enter' = Yes
      default: true,
      message: `Logging out ${userEmail}. Are you sure?`,
    })
  }

  protected createServices(): {
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    this.terminal = new OclifTerminal(this)
    const tokenStore: ITokenStore = new KeychainTokenStore()
    const trackingService: ITrackingService = new MixpanelTrackingService(tokenStore)
    return {
      tokenStore,
      trackingService,
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Logout)
    const {tokenStore, trackingService} = this.createServices()

    try {
      const token = await tokenStore.load()
      if (token === undefined) {
        this.terminal.log('You are not currently logged in.')
        return
      }

      if (!flags.yes) {
        const confirmed = await this.confirmLogout(token.userEmail)
        if (!confirmed) {
          this.terminal.log('Logout cancelled.')
          return
        }
      }

      try {
        await trackingService.track('auth:signed_out')
      } catch {}

      await tokenStore.clear()
      this.terminal.log('Successfully logged out.')
      this.terminal.log("Run 'brv login' to authenticate again.")
    } catch (error) {
      if (error instanceof Error && error.message.includes('keychain')) {
        this.terminal.error('Unable to access system keychain. Please check your system permissions and try again.')
        return
      }

      this.terminal.error(error instanceof Error ? error.message : 'Logout failed')
    }
  }
}
