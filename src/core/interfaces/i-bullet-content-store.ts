/**
 * Port for bullet content file persistence operations.
 * Manages individual markdown files for bullet content.
 */
export interface IBulletContentStore {
  /**
   * Deletes a bullet content file from storage.
   * Does nothing if the content file doesn't exist.
   * @param bulletId The bullet ID
   * @param directory The project directory (defaults to current working directory)
   */
  delete: (bulletId: string, directory?: string) => Promise<void>

  /**
   * Checks if a bullet content file exists.
   * @param bulletId The bullet ID
   * @param directory The project directory (defaults to current working directory)
   * @returns True if content file exists, false otherwise
   */
  exists: (bulletId: string, directory?: string) => Promise<boolean>

  /**
   * Loads bullet content from a markdown file.
   * @param bulletId The bullet ID
   * @param directory The project directory (defaults to current working directory)
   * @returns The content, or undefined if not found
   */
  load: (bulletId: string, directory?: string) => Promise<string | undefined>

  /**
   * Saves bullet content to a markdown file.
   * Creates the directory structure if it doesn't exist.
   * @param bulletId The bullet ID
   * @param content The bullet content
   * @param directory The project directory (defaults to current working directory)
   * @returns The file path where content was saved
   */
  save: (bulletId: string, content: string, directory?: string) => Promise<string>
}
