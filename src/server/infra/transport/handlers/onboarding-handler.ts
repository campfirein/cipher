import type {ITrackingService} from '../../../core/interfaces/services/i-tracking-service.js'
import type {IOnboardingPreferenceStore} from '../../../core/interfaces/storage/i-onboarding-preference-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type OnboardingCompleteRequest,
  type OnboardingCompleteResponse,
  OnboardingEvents,
  type OnboardingGetStateResponse,
} from '../../../../shared/transport/events/onboarding-events.js'

export interface OnboardingHandlerDeps {
  onboardingPreferenceStore: IOnboardingPreferenceStore
  trackingService: ITrackingService
  transport: ITransportServer
}

/**
 * Handles onboarding:* events.
 * Business logic for onboarding flow — no terminal/UI calls.
 */
export class OnboardingHandler {
  private readonly onboardingPreferenceStore: IOnboardingPreferenceStore
  private readonly trackingService: ITrackingService
  private readonly transport: ITransportServer

  constructor(deps: OnboardingHandlerDeps) {
    this.onboardingPreferenceStore = deps.onboardingPreferenceStore
    this.trackingService = deps.trackingService
    this.transport = deps.transport
  }

  setup(): void {
    this.setupGetState()
    this.setupComplete()
  }

  private setupComplete(): void {
    this.transport.onRequest<OnboardingCompleteRequest, OnboardingCompleteResponse>(
      OnboardingEvents.COMPLETE,
      async (data) => {
        try {
          await this.onboardingPreferenceStore.setLastDismissedAt(Date.now())

          const eventName = data?.skipped ? 'onboarding:skipped' : 'onboarding:completed'
          await this.trackingService.track(eventName)

          return {success: true}
        } catch {
          return {success: false}
        }
      },
    )
  }

  private setupGetState(): void {
    this.transport.onRequest<void, OnboardingGetStateResponse>(OnboardingEvents.GET_STATE, async () => {
      try {
        const dismissedAt = await this.onboardingPreferenceStore.getLastDismissedAt()
        return {hasOnboarded: dismissedAt !== undefined}
      } catch {
        return {hasOnboarded: false}
      }
    })
  }
}
