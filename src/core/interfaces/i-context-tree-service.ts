import type {ContextTreeIndex} from '../domain/entities/context-tree-index.js'

/**
 * Interface for context tree operations service.
 * Provides operations for managing the context tree structure including
 * initialization, existence checking, and index retrieval.
 */
export interface IContextTreeService {
  /**
   * Checks if the context tree structure exists in the project.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns True if context tree directory and index.json exist
   */
  exists(directory?: string): Promise<boolean>

  /**
   * Retrieves the context tree index from the project.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns The parsed context tree index
   * @throws Error if index.json doesn't exist or is invalid
   */
  getIndex(directory?: string): Promise<ContextTreeIndex>

  /**
   * Initializes the context tree directory structure and creates the index.
   * Creates .brv/context-tree/ directory with domain subdirectories and context.md files.
   * @param directory - Optional base directory (defaults to current working directory)
   * @returns The absolute path to the created context tree directory
   * @throws Error if context tree already exists or initialization fails
   */
  initialize(directory?: string): Promise<string>
}
