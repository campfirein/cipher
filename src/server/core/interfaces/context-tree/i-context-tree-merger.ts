import type {CogitSnapshotFile} from '../../domain/entities/cogit-snapshot-file.js'
import type {ContextTreeChanges} from '../../domain/entities/context-tree-snapshot.js'

/**
 * Parameters for a merge operation.
 */
export interface MergeParams {
  /** Project base directory */
  directory: string
  /** Remote snapshot files from CoGit pull */
  files: readonly CogitSnapshotFile[]
  /**
   * Local changes detected before the merge.
   * Note: locally-deleted files (localChanges.deleted) are absent from disk and excluded
   * from conflict detection. If the remote has the file, remote wins and re-creates it locally.
   */
  localChanges: ContextTreeChanges
  /**
   * When true, applies first-time-connect semantics: the local context tree has no shared
   * history with the target space, so local always wins unless both sides have independently
   * changed the same file.
   *
   * Concretely:
   * - Clean local files absent from remote are preserved (not deleted).
   * - Clean local files that exist in remote with different content are treated as conflicts
   *   (local copy saved as _N.md, remote written to original path) rather than silently overwritten.
   *
   * Preserved files will appear as "added" on the next getChanges() call, prompting the user
   * to push their local work to the new space.
   *
   * When false (default), clean local files absent from remote are deleted, and clean local
   * files are silently overwritten by remote — the correct behaviour for a regular pull where
   * the remote is the source of truth.
   */
  preserveLocalFiles?: boolean
}

/**
 * Result of a merge operation.
 */
export interface MergeResult {
  /**
   * Files added to the context tree. Includes both remote-originated new files and
   * local files renamed with a _N.md suffix due to conflicts.
   */
  added: string[]
  /**
   * Original paths that had true conflicts (both local and remote changed the same file).
   * For each path in this list, the local version was renamed to a _N.md suffix while
   * the remote version took the original path.
   */
  conflicted: string[]
  /** Local clean files removed because remote deleted them */
  deleted: string[]
  /**
   * Files updated with remote content. Includes clean local files overwritten by remote
   * (regular pull) and paths where both sides independently changed to the same content
   * (convergence — no conflict).
   */
  edited: string[]
  /**
   * Files the user had deleted locally but which remote re-created because remote had a
   * newer version. These paths are present in the context tree again after the merge.
   * Callers should notify the user so they can decide whether to keep or delete them.
   */
  restoredFromRemote: string[]
}

/**
 * Merges remote CoGit snapshot files into the local context tree while
 * preserving local changes. Conflicting local files are renamed with a
 * numeric suffix (_1.md, _2.md, …) before remote content takes the original path.
 *
 * When conflicts occur, the original local versions of conflicted files are copied
 * to .brv/context-tree-conflicts/ for review. This folder is cleared automatically
 * at the start of the next merge.
 *
 * On failure, the context tree is automatically restored to its pre-merge state
 * and the temporary backup is removed.
 */
export interface IContextTreeMerger {
  merge(params: MergeParams): Promise<MergeResult>
}
