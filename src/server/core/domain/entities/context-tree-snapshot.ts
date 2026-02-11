export type {ContextTreeChanges} from '../../../../shared/types/context-tree-changes.js'

import type {ContextTreeChanges} from '../../../../shared/types/context-tree-changes.js'

/**
 * Represents a file's state in the context tree snapshot.
 */
export interface FileState {
  /** SHA-256 hash of the file content */
  hash: string
  /** File size in bytes */
  size: number
}

/**
 * Raw JSON structure for snapshot persistence.
 */
export interface ContextTreeSnapshotJson {
  createdAt: string
  files: Record<string, FileState>
  version: number
}

/**
 * Entity representing a snapshot of the context tree state.
 * Used for tracking changes to context files.
 */
export class ContextTreeSnapshot {
  public static readonly CURRENT_VERSION = 1
  public readonly createdAt: Date
  public readonly files: ReadonlyMap<string, FileState>
  public readonly version: number

  private constructor(version: number, createdAt: Date, files: Map<string, FileState>) {
    this.version = version
    this.createdAt = createdAt
    this.files = files
  }

  /**
   * Creates a new snapshot from the current file states.
   */
  public static create(files: Map<string, FileState>): ContextTreeSnapshot {
    return new ContextTreeSnapshot(ContextTreeSnapshot.CURRENT_VERSION, new Date(), new Map(files))
  }

  /**
   * Deserializes a snapshot from JSON.
   * Returns undefined if the JSON is invalid or version is unsupported.
   */
  public static fromJson(json: ContextTreeSnapshotJson): ContextTreeSnapshot | undefined {
    if (!json || typeof json.version !== 'number' || json.version > ContextTreeSnapshot.CURRENT_VERSION) {
      return undefined
    }

    if (!json.createdAt || !json.files) {
      return undefined
    }

    const files = new Map<string, FileState>()
    for (const [path, state] of Object.entries(json.files)) {
      if (state && typeof state.hash === 'string' && typeof state.size === 'number') {
        files.set(path, {hash: state.hash, size: state.size})
      }
    }

    return new ContextTreeSnapshot(json.version, new Date(json.createdAt), files)
  }

  /**
   * Compares current file states against this snapshot.
   */
  public compare(currentFiles: Map<string, FileState>): ContextTreeChanges {
    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    // Check for added and modified files
    for (const [path, currentState] of currentFiles) {
      const snapshotState = this.files.get(path)
      if (!snapshotState) {
        added.push(path)
      } else if (snapshotState.hash !== currentState.hash) {
        modified.push(path)
      }
    }

    // Check for deleted files
    for (const path of this.files.keys()) {
      if (!currentFiles.has(path)) {
        deleted.push(path)
      }
    }

    return {
      added: added.sort(),
      deleted: deleted.sort(),
      modified: modified.sort(),
    }
  }

  /**
   * Serializes the snapshot to JSON for persistence.
   */
  public toJson(): ContextTreeSnapshotJson {
    const files: Record<string, FileState> = {}
    for (const [path, state] of this.files) {
      files[path] = {hash: state.hash, size: state.size}
    }

    return {
      createdAt: this.createdAt.toISOString(),
      files,
      version: this.version,
    }
  }
}
