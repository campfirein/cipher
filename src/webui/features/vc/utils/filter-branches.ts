import type {VcBranch} from '../../../../shared/transport/events/vc-events'

export function filterBranches<T extends VcBranch>(branches: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...branches]
  return branches.filter((branch) => branch.name.toLowerCase().includes(needle))
}
