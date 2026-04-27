import type {BillingUsageDTO} from '../../../../shared/transport/types/dto'

import {useAuthStore} from '../../auth/stores/auth-store'
import {useGetFreeUserLimit} from '../api/get-free-user-limit'
import {useListBillingUsage} from '../api/list-billing-usage'
import {type BillingTone, type BillingToneInput, getBillingTone} from '../utils/get-billing-tone'

export interface BillingDisplay {
  billingSource?: BillingToneInput
  billingTone: BillingTone
  hasPaidTeam: boolean
  /** Resolved paid org (pinned > workspace > auto-pick). Undefined for free-tier users. */
  paidOrg?: BillingUsageDTO
  showCreditPill: boolean
  usagesByOrg: Record<string, BillingUsageDTO>
}

/**
 * Resolves what credit balance the header / dialog should display.
 *
 * Both upstream queries are kept warm globally — gated only on `isAuthorized`,
 * not on which provider is active or which dialog is open — so opening the
 * provider dialog reads from the React Query cache without an extra round trip.
 *
 * Resolution order:
 *  1. `preferredOrgId` (pinned or workspace team) — binding when set; if its
 *     usage isn't in the bulk response we render nothing rather than silently
 *     showing a different team's credits.
 *  2. Auto-select: only kicks in when no preference is set, mirroring the
 *     BE's "no teamId sent → pick the user's first paid team" behavior.
 *  3. Free-user monthly window — when the user has no paid team at all.
 */
export function useBillingDisplay({preferredOrgId}: {preferredOrgId?: string} = {}): BillingDisplay {
  const isAuthorized = useAuthStore((s) => s.isAuthorized)

  const {data: usagesData} = useListBillingUsage({enabled: isAuthorized})
  const usagesByOrg = usagesData?.usage ?? {}
  const hasPaidTeam = Object.keys(usagesByOrg).length > 0

  // Wait for the bulk fetch to resolve before deciding to ask for free-tier
  // limits — otherwise we'd request a free quota for paid users on first render.
  const {data: freeData} = useGetFreeUserLimit({
    enabled: isAuthorized && usagesData !== undefined && !hasPaidTeam,
  })
  const freeMonthly = freeData?.limit?.monthly

  const paidOrg = preferredOrgId ? usagesByOrg[preferredOrgId] : Object.values(usagesByOrg)[0]
  const billingSource: BillingToneInput | undefined = hasPaidTeam ? paidOrg : freeMonthly
  const billingTone = getBillingTone(billingSource)

  return {
    billingSource,
    billingTone,
    hasPaidTeam,
    paidOrg: hasPaidTeam ? paidOrg : undefined,
    showCreditPill: billingSource !== undefined,
    usagesByOrg,
  }
}
