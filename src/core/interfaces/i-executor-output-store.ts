import type {ExecutorOutput} from '../domain/entities/executor-output.js'

/**
 * Interface for executor output storage operations.
 * Implementations can be file-based (for production) or in-memory (for testing).
 */
export interface IExecutorOutputStore {
  /**
   * Saves executor output to storage.
   * @param output - The executor output to save
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns The absolute path where the executor output was saved
   */
  save(output: ExecutorOutput, directory?: string): Promise<string>
}
