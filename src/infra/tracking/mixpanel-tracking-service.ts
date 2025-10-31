import mixpanel, {Mixpanel} from 'mixpanel'

import {getCurrentConfig} from '../../config/environment.js'
import {EventName, PropertyDict} from '../../core/domain/entities/event.js'
import {ITokenStore} from '../../core/interfaces/i-token-store.js'
import {ITrackingService} from '../../core/interfaces/i-tracking-service.js'

/**
 * Tracking service implementation using the Mixpanel library.
 */
export class MixpanelTrackingService implements ITrackingService {
  private readonly mp: Mixpanel
  private readonly tokenStore: ITokenStore

  constructor(tokenStore: ITokenStore, mp?: Mixpanel) {
    this.tokenStore = tokenStore
    if (mp) {
      // Injected dependencies for testing
      this.mp = mp
    } else {
      // Initialize with real implementations for production
      const envConfig = getCurrentConfig()
      this.mp = mixpanel.init(envConfig.mixpanelToken)
    }
  }

  public async track(eventName: EventName, properties?: PropertyDict): Promise<void> {
    try {
      const identificationProps = await this.getIdentificationProperties()

      this.mp.track(`cli:${eventName}`, {
        ...identificationProps,
        ...properties,
        beta: true,
      })
    } catch (error) {
      console.error(`Failed to track event ${eventName}:`, error)
    }
  }

  private async getIdentificationProperties(): Promise<PropertyDict> {
    // 2. Load and validate authentication token
    const token = await this.tokenStore.load()
    if (token) {
      return {
        $user_id: token.userId, // eslint-disable-line camelcase
      }
    }

    return {}
  }
}
