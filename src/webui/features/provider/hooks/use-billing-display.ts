import type {BillingUsageDTO} from '../../../../shared/transport/types/dto'

import {type BillingTone, type BillingToneInput, getBillingTone} from '../utils/get-billing-tone'
import {resolveBilledTeam} from '../utils/resolve-billed-team'
import {useBillingUsages} from './use-billing-usages'
import {useFreeMonthlyCredits} from './use-free-monthly-credits'

export interface BillingDisplay {
  billedOrgId?: string
  billingSource?: BillingToneInput
  billingTone: BillingTone
  hasPaidTeam: boolean
  needsPickPrompt: boolean
  paidOrg?: BillingUsageDTO
  showCreditPill: boolean
  usagesByOrg: Record<string, BillingUsageDTO>
}

export function useBillingDisplay({preferredOrgId}: {preferredOrgId?: string} = {}): BillingDisplay {
  const {hasPaidTeam, isLoaded, paidOrganizationIds, usagesByOrg} = useBillingUsages()
  const freeMonthly = useFreeMonthlyCredits({enabled: isLoaded && !hasPaidTeam})

  const resolvedTeam = resolveBilledTeam({hasPaidTeam, paidOrganizationIds, preferredOrgId, usagesByOrg})
  const isPaidOrg = resolvedTeam !== undefined && resolvedTeam.tier !== 'FREE'
  const billingSource: BillingToneInput | undefined = resolvedTeam ?? freeMonthly
  const paidOrg = isPaidOrg ? resolvedTeam : undefined

  return {
    billedOrgId: preferredOrgId ?? paidOrg?.organizationId,
    billingSource,
    billingTone: getBillingTone(billingSource),
    hasPaidTeam,
    needsPickPrompt: paidOrganizationIds.length > 1 && resolvedTeam === undefined,
    paidOrg,
    showCreditPill: billingSource !== undefined,
    usagesByOrg,
  }
}
