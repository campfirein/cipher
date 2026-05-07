import type {BillingUsageDTO} from '../../../../shared/transport/types/dto'

import {useAuthStore} from '../../auth/stores/auth-store'
import {useGetFreeUserLimit} from '../api/get-free-user-limit'
import {useListBillingUsage} from '../api/list-billing-usage'
import {type BillingTone, type BillingToneInput, getBillingTone} from '../utils/get-billing-tone'

export interface BillingDisplay {
  billingSource?: BillingToneInput
  billingTone: BillingTone
  hasPaidTeam: boolean
  paidOrg?: BillingUsageDTO
  showCreditPill: boolean
  usagesByOrg: Record<string, BillingUsageDTO>
}

export function useBillingDisplay({preferredOrgId}: {preferredOrgId?: string} = {}): BillingDisplay {
  const isAuthorized = useAuthStore((s) => s.isAuthorized)

  const {data: usagesData} = useListBillingUsage({enabled: isAuthorized})
  const usagesByOrg = usagesData?.usage ?? {}
  const paidUsages = Object.values(usagesByOrg).filter((u) => u.tier !== 'FREE')
  const hasPaidTeam = paidUsages.length > 0

  const {data: freeData} = useGetFreeUserLimit({
    enabled: isAuthorized && usagesData !== undefined && !hasPaidTeam,
  })
  const freeMonthly = freeData?.limit?.monthly

  const autoPick = paidUsages.length === 1 ? paidUsages[0] : undefined
  const resolvedTeam = preferredOrgId ? usagesByOrg[preferredOrgId] : autoPick
  const isPaidOrg = resolvedTeam !== undefined && resolvedTeam.tier !== 'FREE'
  const billingSource: BillingToneInput | undefined = resolvedTeam ?? freeMonthly
  const billingTone = getBillingTone(billingSource)

  return {
    billingSource,
    billingTone,
    hasPaidTeam,
    paidOrg: isPaidOrg ? resolvedTeam : undefined,
    showCreditPill: billingSource !== undefined,
    usagesByOrg,
  }
}
