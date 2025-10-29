import type {ReflectorOutput} from '../domain/entities/reflector-output.js'

/**
 * Interface for reflection output storage operations.
 * Implementations can be file-based (for production) or in-memory (for testing).
 */
export interface IReflectionStore {
  /**
   * Loads the most recent reflections from storage.
   * @param directory - Optional base directory (defaults to current working directory)
   * @param count - Maximum number of recent reflections to load (default: 3)
   * @returns Array of recent reflections, ordered from most recent to oldest
   */
  loadRecent(directory?: string, count?: number): Promise<ReflectorOutput[]>

  /**
   * Saves a reflection output to storage.
   * @param reflection - The reflection output to save
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns The absolute path where the reflection was saved
   */
  save(reflection: ReflectorOutput, directory?: string): Promise<string>
}
