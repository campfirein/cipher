import type {CogitSnapshotFile} from '../domain/entities/cogit-snapshot-file.js'

/**
 * Result of a sync operation.
 */
export type SyncResult = {
  added: string[]
  deleted: string[]
  edited: string[]
}

/**
 * Parameters for the sync operation.
 */
export type SyncParams = {
  directory?: string
  files: readonly CogitSnapshotFile[]
}

/**
 * Interface for context tree writer operations.
 * This should be used to process pull response from Cogit.
 * Provides file synchronization capabilities for the context tree.
 */
export interface IContextTreeWriterService {
  /**
   * Synchronizes the context tree with the provided files.
   * - Files present in params but not locally are added
   * - Files present in both are edited
   * - Files present locally but not in params are deleted
   * @param params - Sync parameters including files and optional directory
   * @returns Result containing arrays of added, edited, and deleted file paths
   */
  sync: (params: SyncParams) => Promise<SyncResult>
}
