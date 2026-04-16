import type {VcBranch} from './filter-branches'

export type BranchPartition<T extends VcBranch> = {
  locals: T[]
  remotesByHost: Map<string, T[]>
}

const REMOTE_REFS_PREFIX = 'refs/remotes/'

function hostOf(branchName: string): string {
  const normalized = branchName.startsWith(REMOTE_REFS_PREFIX)
    ? branchName.slice(REMOTE_REFS_PREFIX.length)
    : branchName

  const slash = normalized.indexOf('/')
  if (slash === -1) return 'unknown'
  return normalized.slice(0, slash)
}

export function partitionBranches<T extends VcBranch>(branches: readonly T[]): BranchPartition<T> {
  const locals: T[] = []
  const remotesByHost = new Map<string, T[]>()

  for (const branch of branches) {
    if (branch.isRemote) {
      const host = hostOf(branch.name)
      const bucket = remotesByHost.get(host)
      if (bucket) {
        bucket.push(branch)
      } else {
        remotesByHost.set(host, [branch])
      }
    } else {
      locals.push(branch)
    }
  }

  return {locals, remotesByHost}
}
