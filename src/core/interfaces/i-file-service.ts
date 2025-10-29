/**
 * Write mode for file operations.
 * - `append`: Add content to the end of the file
 * - `overwrite`: Replace the entire file content
 */
export type WriteMode = 'append' | 'overwrite'

/**
 * Interface for file service operations.
 */
export interface IFileService {
  /**
   * Checks if a file exists at the specified path.
   *
   * @param filePath The path to the file to check.
   * @returns A promise that resolves with `true` if the file exists, `false` otherwise.
   */
  exists: (filePath: string) => Promise<boolean>

  /**
   * Reads content from the specified file.
   *
   * @param filePath The path to the file to read from.
   * @returns A promise that resolves with the content of the file.
   */
  read: (filePath: string) => Promise<string>

  /**
   * Writes content to the specified file.
   *
   * @param content The content to write.
   * @param filePath The path to the file to write to.
   * @param mode The mode to write the content in.
   * @returns A promise that resolves when the content has been written.
   */
  write: (content: string, filePath: string, mode: WriteMode) => Promise<void>
}
