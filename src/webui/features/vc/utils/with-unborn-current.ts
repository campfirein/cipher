import type {VcBranch} from './filter-branches'

/**
 * When HEAD points at `refs/heads/<name>` but no commits exist, `listBranches`
 * returns an empty array — the branch doesn't have a ref file yet. Prepend a
 * synthetic entry for the current branch so the UI still shows it.
 */
export function withUnbornCurrent<T extends VcBranch>(
  branches: readonly T[],
  currentName: string | undefined,
): T[] {
  if (!currentName) return [...branches]
  if (branches.some((b) => !b.isRemote && b.name === currentName)) return [...branches]

  const synthesized = {isCurrent: true, isRemote: false, name: currentName} as T
  return [synthesized, ...branches]
}
