/** File change type shown in the Changes panel. */
export type ChangeFileStatus = 'added' | 'deleted' | 'modified' | 'unmerged' | 'untracked'

/** Specific kind of merge conflict (mirrors git status XY codes). */
export type ConflictType = 'both_added' | 'both_modified' | 'deleted_modified'

export interface ChangeFile {
  /** Specific conflict kind; only set when `status === 'unmerged'`. */
  conflictType?: ConflictType
  /** True when the working-tree file still contains `<<<<<<<` / `=======` / `>>>>>>>` markers. */
  hasMarkers?: boolean
  /** Whether this file is currently staged. */
  isStaged: boolean
  /** Relative path from the repo root. */
  path: string
  status: ChangeFileStatus
}
