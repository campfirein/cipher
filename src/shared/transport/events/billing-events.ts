import type {BillingFreeUserLimitDTO, BillingUsageDTO} from '../types/dto.js'

export const BillingEvents = {
  GET_FREE_USER_LIMIT: 'billing:getFreeUserLimit',
  GET_PINNED_ORGANIZATION: 'billing:getPinnedOrganization',
  GET_USAGE: 'billing:getUsage',
  LIST_USAGE: 'billing:listUsage',
  SET_PINNED_ORGANIZATION: 'billing:setPinnedOrganization',
} as const

export interface BillingGetUsageRequest {
  /** Organization (team) whose usage should be reported. */
  organizationId: string
}

export interface BillingGetUsageResponse {
  error?: string
  usage?: BillingUsageDTO
}

export interface BillingListUsageResponse {
  /** Top-level error (auth/transport). When present, `usage` is omitted. */
  error?: string
  /** Every organization the user belongs to, keyed by organizationId. */
  usage?: Record<string, BillingUsageDTO>
}

export interface BillingGetFreeUserLimitResponse {
  error?: string
  limit?: BillingFreeUserLimitDTO
}

export interface BillingGetPinnedOrganizationResponse {
  /** When undefined, no pin is set and the consumer should fall back to its workspace default. */
  organizationId?: string
}

export interface BillingSetPinnedOrganizationRequest {
  /** Pass `undefined` (or omit) to clear the pin. */
  organizationId?: string
}

export interface BillingSetPinnedOrganizationResponse {
  error?: string
  success: boolean
}
