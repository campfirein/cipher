import type {
  FolderPackConfig,
  FolderPackResult,
  PackProgressCallback,
} from '../domain/folder-pack/types.js'

/**
 * Interface for folder packing operations.
 * Provides functionality to pack folders (codebases or document folders)
 * into structured formats suitable for LLM context consumption.
 */
export interface IFolderPackService {
  /**
   * Generate XML output from a pack result.
   * Produces structured XML suitable for LLM consumption.
   *
   * @param result - The pack result to convert
   * @returns XML string representation of the packed folder
   */
  generateXml(result: FolderPackResult): string

  /**
   * Initialize the folder pack service.
   * Must be called before any pack operations.
   */
  initialize(): Promise<void>

  /**
   * Pack a folder into a structured result.
   * Collects all text files, extracts PDF content, and generates
   * a directory tree representation.
   *
   * @param folderPath - Path to the folder to pack (relative or absolute)
   * @param config - Optional partial configuration (merged with defaults)
   * @param onProgress - Optional callback for progress updates
   * @returns Pack result with files, tree, and metadata
   * @throws DirectoryNotFoundError if folder doesn't exist
   * @throws PathNotAllowedError if path is not in allowed paths
   */
  pack(
    folderPath: string,
    config?: Partial<FolderPackConfig>,
    onProgress?: PackProgressCallback,
  ): Promise<FolderPackResult>
}
