import type {IVcStatusResponse} from '../../../../shared/transport/events/vc-events'
import type {ChangeFile, ConflictType} from '../types'

const CONFLICT_TYPES: readonly ConflictType[] = ['both_added', 'both_modified', 'deleted_modified']

function toConflictType(value: string): ConflictType | undefined {
  return (CONFLICT_TYPES as readonly string[]).includes(value) ? (value as ConflictType) : undefined
}

/** Splits a status response into merge, staged and unstaged file arrays for the Changes UI. */
export function statusToFiles(status: IVcStatusResponse | undefined): {
  staged: ChangeFile[]
  unmerged: ChangeFile[]
  unstaged: ChangeFile[]
} {
  if (!status) return {staged: [], unmerged: [], unstaged: []}

  const markerSet = new Set(status.conflictMarkerFiles ?? [])

  const unmerged: ChangeFile[] = (status.unmerged ?? []).map<ChangeFile>(({path, type}) => ({
    conflictType: toConflictType(type),
    hasMarkers: markerSet.has(path),
    isStaged: false,
    path,
    status: 'unmerged',
  }))

  const staged: ChangeFile[] = [
    ...status.staged.added.map<ChangeFile>((path) => ({isStaged: true, path, status: 'added'})),
    ...status.staged.modified.map<ChangeFile>((path) => ({isStaged: true, path, status: 'modified'})),
    ...status.staged.deleted.map<ChangeFile>((path) => ({isStaged: true, path, status: 'deleted'})),
  ]

  const unstaged: ChangeFile[] = [
    ...status.unstaged.modified.map<ChangeFile>((path) => ({isStaged: false, path, status: 'modified'})),
    ...status.unstaged.deleted.map<ChangeFile>((path) => ({isStaged: false, path, status: 'deleted'})),
    ...status.untracked.map<ChangeFile>((path) => ({isStaged: false, path, status: 'untracked'})),
  ]

  // Sort alphabetically by path for a stable display order
  const byPath = (a: ChangeFile, b: ChangeFile) => a.path.localeCompare(b.path)
  return {
    staged: staged.sort(byPath),
    unmerged: unmerged.sort(byPath),
    unstaged: unstaged.sort(byPath),
  }
}
