import type {Playbook} from '../domain/entities/playbook.js'

/**
 * Port for playbook persistence operations.
 * Implementations can use file system, database, or remote storage.
 */
export interface IPlaybookStore {
  /**
   * Deletes a playbook from storage.
   * Does nothing if the playbook doesn't exist.
   * @param directory The project directory (defaults to current working directory)
   */
  delete: (directory?: string) => Promise<void>

  /**
   * Checks if a playbook exists in the specified directory.
   * @param directory The project directory (defaults to current working directory)
   * @returns True if playbook exists, false otherwise
   */
  exists: (directory?: string) => Promise<boolean>

  /**
   * Loads a playbook from storage.
   * @param directory The project directory (defaults to current working directory)
   * @returns The playbook, or undefined if not found
   */
  load: (directory?: string) => Promise<Playbook | undefined>

  /**
   * Saves a playbook to storage.
   * Creates the directory structure if it doesn't exist.
   * @param playbook The playbook to save
   * @param directory The project directory (defaults to current working directory)
   */
  save: (playbook: Playbook, directory?: string) => Promise<void>
}
