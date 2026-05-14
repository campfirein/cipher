import type {BillingUsageDTO} from '../../../../shared/transport/types/dto'

import {useAuthStore} from '../../auth/stores/auth-store'
import {useListBillingUsage} from '../api/list-billing-usage'
import {getPaidOrganizationIds} from '../utils/has-paid-team'

export interface BillingUsagesState {
  hasPaidTeam: boolean
  isLoaded: boolean
  paidOrganizationIds: string[]
  usagesByOrg: Record<string, BillingUsageDTO>
}

export function useBillingUsages(): BillingUsagesState {
  const isAuthorized = useAuthStore((s) => s.isAuthorized)
  const {data} = useListBillingUsage({enabled: isAuthorized})
  const usagesByOrg = data?.usage ?? {}
  const paidOrganizationIds = getPaidOrganizationIds(usagesByOrg)
  return {
    hasPaidTeam: paidOrganizationIds.length > 0,
    isLoaded: data !== undefined,
    paidOrganizationIds,
    usagesByOrg,
  }
}
