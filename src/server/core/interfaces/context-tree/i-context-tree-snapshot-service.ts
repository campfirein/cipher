import type {ContextTreeChanges, FileState} from '../../domain/entities/context-tree-snapshot.js'

/**
 * Interface for context tree snapshot operations.
 * Provides change tracking by comparing current file states against saved snapshots.
 */
export interface IContextTreeSnapshotService {
  /**
   * Compares current context tree state against the saved snapshot.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns Changes detected (added, modified, deleted files)
   */
  getChanges(directory?: string): Promise<ContextTreeChanges>

  /**
   * Gets the current state of all files in the context tree.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns Map of relative file paths to their current state (hash and size)
   */
  getCurrentState(directory?: string): Promise<Map<string, FileState>>

  /**
   * Gets the saved snapshot state (the last committed baseline).
   * Returns an empty map if no snapshot exists.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns Map of relative file paths to their snapshotted state (hash and size)
   */
  getSnapshotState(directory?: string): Promise<Map<string, FileState>>

  /**
   * Checks if a snapshot file exists.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns True if snapshot exists
   */
  hasSnapshot(directory?: string): Promise<boolean>

  /**
   * Creates an empty snapshot (no files tracked).
   * Use this to establish a baseline where all current files will appear as "added".
   * @param directory - Optional base directory (defaults to current working directory)
   */
  initEmptySnapshot(directory?: string): Promise<void>

  /**
   * Creates or updates the snapshot from current context tree state.
   * @param directory - Optional base directory (defaults to current working directory)
   */
  saveSnapshot(directory?: string): Promise<void>

  /**
   * Saves a snapshot from a pre-computed file state map.
   * Use this after a merge to record only the remote files, so that
   * locally preserved/renamed files appear as "added" on next getChanges().
   * @param state - Map of relative file paths to their file states
   * @param directory - Optional base directory (defaults to current working directory)
   */
  saveSnapshotFromState(state: Map<string, FileState>, directory?: string): Promise<void>
}
