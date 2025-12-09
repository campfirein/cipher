import {confirm} from '@inquirer/prompts'
import {Command, Flags} from '@oclif/core'

import type {IGlobalConfigStore} from '../core/interfaces/i-global-config-store.js'
import type {ITokenStore} from '../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
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

  protected async confirmLogout(userEmail: string): Promise<boolean> {
    return confirm({
      // Pressing 'Enter' = Yes
      default: true,
      message: `Logging out ${userEmail}. Are you sure?`,
    })
  }

  protected createServices(): {
    globalConfigStore: IGlobalConfigStore
    tokenStore: ITokenStore
    trackingService: ITrackingService
  } {
    const globalConfigStore: IGlobalConfigStore = new FileGlobalConfigStore()
    const tokenStore: ITokenStore = new KeychainTokenStore()
    const trackingService: ITrackingService = new MixpanelTrackingService({
      globalConfigStore,
      tokenStore,
    })
    return {
      globalConfigStore,
      tokenStore,
      trackingService,
    }
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Logout)
    const {globalConfigStore, tokenStore, trackingService} = this.createServices()

    try {
      const token = await tokenStore.load()
      if (token === undefined) {
        this.log('You are not currently logged in.')
        return
      }

      if (!flags.yes) {
        const confirmed = await this.confirmLogout(token.userEmail)
        if (!confirmed) {
          this.log('Logout cancelled.')
          return
        }
      }

      // Track sign-out event with current device ID before regenerating
      try {
        await trackingService.track('auth:signed_out')
      } catch {}

      // Clear auth token from keychain
      await tokenStore.clear()

      // Regenerate device ID to break tracking continuity (best effort)
      try {
        await globalConfigStore.regenerateDeviceId()
      } catch {}

      this.log('Successfully logged out.')
      this.log("Run 'brv login' to authenticate again.")
    } catch (error) {
      if (error instanceof Error && error.message.includes('keychain')) {
        this.error('Unable to access system keychain. Please check your system permissions and try again.')
      }

      this.error(error instanceof Error ? error.message : 'Logout failed')
    }
  }
}
