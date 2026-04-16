export type VcBranch = {isCurrent: boolean; isRemote: boolean; name: string}

export function filterBranches<T extends VcBranch>(branches: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...branches]
  return branches.filter((branch) => branch.name.toLowerCase().includes(needle))
}
