import type {VcBranch} from '../../../../shared/transport/events/vc-events'

/**
 * When HEAD points at `refs/heads/<name>` but no commits exist, `listBranches`
 * returns an empty array — the branch doesn't have a ref file yet. Prepend a
 * synthetic entry for the current branch so the UI still shows it.
 */
export function withUnbornCurrent(branches: readonly VcBranch[], currentName?: string): VcBranch[] {
  if (!currentName) return [...branches]
  if (branches.some((b) => !b.isRemote && b.name === currentName)) return [...branches]

  const synthesized: VcBranch = {isCurrent: true, isRemote: false, name: currentName}
  return [synthesized, ...branches]
}
