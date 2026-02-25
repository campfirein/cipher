import type {CogitSnapshotFile} from '../../domain/entities/cogit-snapshot-file.js'
import type {ContextTreeChanges, FileState} from '../../domain/entities/context-tree-snapshot.js'

/**
 * Parameters for a merge operation.
 */
export interface MergeParams {
  /** Project base directory */
  directory: string
  /** Remote snapshot files from CoGit pull */
  files: readonly CogitSnapshotFile[]
  /** Local changes detected before the merge */
  localChanges: ContextTreeChanges
}

/**
 * Result of a merge operation.
 */
export interface MergeResult {
  /** Remote files added to the context tree */
  added: string[]
  /**
   * Path to the conflict review directory (.brv/context-tree-conflict/).
   * Only present when conflicted.length > 0. Contains the original local versions
   * of conflicted files for user review. Cleared automatically at the start of the next merge.
   */
  conflictDir?: string
  /**
   * Original paths that had true conflicts (both local and remote changed the same file).
   * For each path in this list, the local version was renamed to a _N.md suffix while
   * the remote version took the original path.
   */
  conflicted: string[]
  /** Local clean files removed because remote deleted them */
  deleted: string[]
  /** Remote files that overwrote clean local files */
  edited: string[]
  /**
   * File states for remote files only — pass to saveSnapshotFromState()
   * so that preserved/renamed local files appear as "added" on next getChanges().
   */
  remoteFileStates: Map<string, FileState>
}

/**
 * Merges remote CoGit snapshot files into the local context tree while
 * preserving local changes. Conflicting local files are renamed with a
 * numeric suffix (_1.md, _2.md, …) before remote content takes the original path.
 *
 * When conflicts occur, the original local versions of conflicted files are copied
 * to .brv/context-tree-conflict/ for review. This folder is cleared automatically
 * at the start of the next merge.
 *
 * On failure, the context tree is automatically restored to its pre-merge state
 * and the temporary backup is removed. The caller is responsible for rolling back
 * any config changes (space ID, team ID).
 */
export interface IContextTreeMerger {
  merge(params: MergeParams): Promise<MergeResult>
}
