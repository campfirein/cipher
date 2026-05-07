export interface BillingTeamResolverInput {
  paidOrganizationIds: readonly string[]
  pinnedTeamId?: string
  workspaceTeamId?: string
}

export function resolveBillingTeamId(input: BillingTeamResolverInput): string | undefined {
  const { paidOrganizationIds, pinnedTeamId, workspaceTeamId } = input

  if (pinnedTeamId) return pinnedTeamId

  if (workspaceTeamId && paidOrganizationIds.includes(workspaceTeamId)) {
    return workspaceTeamId
  }

  if (paidOrganizationIds.length === 1) return paidOrganizationIds[0]

  return undefined
}
