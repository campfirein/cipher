import type {DeltaBatch} from '../domain/entities/delta-batch.js'

/**
 * Interface for delta batch storage operations.
 * Implementations can be file-based (for production) or in-memory (for testing).
 */
export interface IDeltaStore {
  /**
   * Saves a delta batch to storage.
   * @param deltaBatch - The delta batch to save
   * @param hint - Optional hint to include in the filename for identification
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns The absolute path where the delta batch was saved
   */
  save(deltaBatch: DeltaBatch, hint?: string, directory?: string): Promise<string>
}
