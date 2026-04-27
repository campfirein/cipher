import type {BillingUsageDTO} from '../../../../shared/transport/types/dto.js'
import type {IBillingService} from '../../../core/interfaces/services/i-billing-service.js'
import type {IAuthStateStore} from '../../../core/interfaces/state/i-auth-state-store.js'
import type {IBillingConfigStore} from '../../../core/interfaces/storage/i-billing-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  BillingEvents,
  type BillingGetFreeUserLimitResponse,
  type BillingGetPinnedOrganizationResponse,
  type BillingGetUsageRequest,
  type BillingGetUsageResponse,
  type BillingListUsageResponse,
  type BillingSetPinnedOrganizationRequest,
  type BillingSetPinnedOrganizationResponse,
} from '../../../../shared/transport/events/billing-events.js'
import {getErrorMessage} from '../../../utils/error-helpers.js'

export interface BillingHandlerDeps {
  authStateStore: IAuthStateStore
  billingConfigStore: IBillingConfigStore
  billingService: IBillingService
  transport: ITransportServer
}

const NOT_AUTHENTICATED_ERROR = 'Billing data requires sign-in. Run /login or brv login to sign in.'

/**
 * Handles billing:* events. Reads usage data from the upstream billing
 * service for the authenticated user, and persists the user's pinned billing
 * organization. Errors flow back as an envelope (`{error}`) so the webui can
 * render inline status without try/catch on every call.
 */
export class BillingHandler {
  private readonly authStateStore: IAuthStateStore
  private readonly billingConfigStore: IBillingConfigStore
  private readonly billingService: IBillingService
  private readonly transport: ITransportServer

  constructor(deps: BillingHandlerDeps) {
    this.authStateStore = deps.authStateStore
    this.billingConfigStore = deps.billingConfigStore
    this.billingService = deps.billingService
    this.transport = deps.transport
  }

  setup(): void {
    this.setupGetUsage()
    this.setupListUsage()
    this.setupGetFreeUserLimit()
    this.setupGetPinnedOrganization()
    this.setupSetPinnedOrganization()
  }

  private setupGetFreeUserLimit(): void {
    this.transport.onRequest<undefined, BillingGetFreeUserLimitResponse>(
      BillingEvents.GET_FREE_USER_LIMIT,
      async () => {
        const token = this.authStateStore.getToken()
        if (!token?.isValid()) {
          return {error: NOT_AUTHENTICATED_ERROR}
        }

        try {
          const limit = await this.billingService.getFreeUserLimit(token.sessionKey)
          return {limit}
        } catch (error) {
          return {error: getErrorMessage(error)}
        }
      },
    )
  }

  private setupGetPinnedOrganization(): void {
    this.transport.onRequest<undefined, BillingGetPinnedOrganizationResponse>(
      BillingEvents.GET_PINNED_ORGANIZATION,
      async () => {
        const organizationId = await this.billingConfigStore.getPinnedOrganizationId()
        return organizationId === undefined ? {} : {organizationId}
      },
    )
  }

  private setupGetUsage(): void {
    this.transport.onRequest<BillingGetUsageRequest, BillingGetUsageResponse>(
      BillingEvents.GET_USAGE,
      async (data) => {
        const token = this.authStateStore.getToken()
        if (!token?.isValid()) {
          return {error: NOT_AUTHENTICATED_ERROR}
        }

        try {
          const usages = await this.billingService.getUsages(token.sessionKey)
          const usage = usages.find((u) => u.organizationId === data.organizationId)
          if (!usage) {
            return {error: `No billing usage found for organization ${data.organizationId}`}
          }

          return {usage}
        } catch (error) {
          return {error: getErrorMessage(error)}
        }
      },
    )
  }

  private setupListUsage(): void {
    this.transport.onRequest<undefined, BillingListUsageResponse>(BillingEvents.LIST_USAGE, async () => {
      const token = this.authStateStore.getToken()
      if (!token?.isValid()) {
        return {error: NOT_AUTHENTICATED_ERROR}
      }

      try {
        const usages = await this.billingService.getUsages(token.sessionKey)
        const usage: Record<string, BillingUsageDTO> = {}
        for (const entry of usages) {
          usage[entry.organizationId] = entry
        }

        return {usage}
      } catch (error) {
        return {error: getErrorMessage(error)}
      }
    })
  }

  private setupSetPinnedOrganization(): void {
    this.transport.onRequest<BillingSetPinnedOrganizationRequest, BillingSetPinnedOrganizationResponse>(
      BillingEvents.SET_PINNED_ORGANIZATION,
      async (data) => {
        try {
          await this.billingConfigStore.setPinnedOrganizationId(data.organizationId)
          return {success: true}
        } catch (error) {
          return {error: getErrorMessage(error), success: false}
        }
      },
    )
  }
}
