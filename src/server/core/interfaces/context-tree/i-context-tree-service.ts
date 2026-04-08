/**
 * Interface for context tree operations service.
 * Provides operations for managing the context tree structure including
 * initialization and existence checking.
 */
export interface IContextTreeService {
  /**
   * Deletes the context tree directory and its contents.
   * @param directory - Optional base directory (defaults to current working directory)
   */
  delete(directory?: string): Promise<void>

  /**
   * Checks if the context tree structure exists in the project.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns True if context tree directory exists
   */
  exists(directory?: string): Promise<boolean>

  /**
   * Checks if a git repository (.git directory) exists in the context tree.
   * @param directory - Base directory
   * @returns True if .git directory exists inside the context tree
   */
  hasGitRepo(directory: string): Promise<boolean>

  /**
   * Initializes the context tree directory structure.
   * Creates .brv/context-tree/ directory with domain subdirectories and context.md files.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns The absolute path to the created context tree directory
   * @throws Error if context tree already exists or initialization fails
   */
  initialize(directory?: string): Promise<string>

  /**
   * Returns the absolute path to the context tree directory without creating it.
   * @param directory - Base directory
   */
  resolvePath(directory: string): string
}
