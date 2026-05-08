import type {BillingUsageDTO} from '../../../../shared/transport/types/dto'

export function hasPaidTeam(usage?: Record<string, BillingUsageDTO>): boolean {
  if (!usage) return false
  return Object.values(usage).some((u) => u.tier !== 'FREE')
}
