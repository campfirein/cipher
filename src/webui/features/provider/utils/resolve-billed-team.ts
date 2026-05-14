import type {BillingUsageDTO} from '../../../../shared/transport/types/dto'

export function resolveBilledTeam(args: {
  hasPaidTeam: boolean
  paidOrganizationIds: readonly string[]
  preferredOrgId?: string
  usagesByOrg: Record<string, BillingUsageDTO>
}): BillingUsageDTO | undefined {
  const {hasPaidTeam, paidOrganizationIds, preferredOrgId, usagesByOrg} = args
  if (!hasPaidTeam) return undefined
  const pinUsage = preferredOrgId ? usagesByOrg[preferredOrgId] : undefined
  const autoPickUsage = paidOrganizationIds.length === 1 ? usagesByOrg[paidOrganizationIds[0]] : undefined
  return pinUsage ?? autoPickUsage
}
