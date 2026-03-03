/**
 * Store for pre-curate file content backups.
 *
 * When a curate operation modifies a file that was previously pushed (exists in snapshot),
 * the original content is backed up here. The review UI uses these backups to compute diffs
 * (snapshot version → current version). Backups are cleared after a successful push.
 */
export interface IReviewBackupStore {
  /** Remove all backups. Called after a successful push creates a new snapshot. */
  clear(): Promise<void>
  /** Check if a backup exists for the given relative path. */
  has(relativePath: string): Promise<boolean>
  /** Read the backed-up content for a relative path. Returns null if no backup exists. */
  read(relativePath: string): Promise<null | string>
  /** Save a backup of file content. No-op if a backup already exists (first-write wins). */
  save(relativePath: string, content: string): Promise<void>
}
