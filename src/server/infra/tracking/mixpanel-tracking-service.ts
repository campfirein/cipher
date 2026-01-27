import mixpanel, {Mixpanel} from 'mixpanel'

import {getCurrentConfig} from '../../config/environment.js'
import {EventName, PropertyDict} from '../../core/domain/entities/event.js'
import {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'
import {ITrackingService} from '../../core/interfaces/services/i-tracking-service.js'
import {IGlobalConfigStore} from '../../core/interfaces/storage/i-global-config-store.js'

/**
 * Parameters for creating a MixpanelTrackingService instance.
 */
export interface MixpanelTrackingServiceParams {
  readonly globalConfigStore: IGlobalConfigStore
  readonly mixpanel?: Mixpanel
  readonly tokenStore: ITokenStore
}

/**
 * Tracking service implementation using the Mixpanel library.
 */
export class MixpanelTrackingService implements ITrackingService {
  private readonly globalConfigStore: IGlobalConfigStore
  private readonly mp: Mixpanel
  private readonly tokenStore: ITokenStore
  

  public constructor(params: MixpanelTrackingServiceParams) {
    this.tokenStore = params.tokenStore
    this.globalConfigStore = params.globalConfigStore

    if (params.mixpanel === undefined) {
      // Initialize with real implementations for production
      const envConfig = getCurrentConfig()
      this.mp = mixpanel.init(envConfig.mixpanelToken)
    } else {
      // Injected dependencies for testing
      this.mp = params.mixpanel
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
    // Always include $device_id for anonymous/pre-auth tracking
    const deviceId = await this.globalConfigStore.getOrCreateDeviceId()
    const props: PropertyDict = {
      $device_id: deviceId, // eslint-disable-line camelcase
    }

    // Add $user_id if authenticated (enables Mixpanel identity merging)
    const token = await this.tokenStore.load()
    if (token !== undefined) {
      props.$user_id = token.userId // eslint-disable-line camelcase
    }

    return props
  }
}
