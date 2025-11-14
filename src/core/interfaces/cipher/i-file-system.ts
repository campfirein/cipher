import type {
  EditFileOptions,
  EditOperation,
  EditResult,
  FileContent,
  GlobOptions,
  GlobResult,
  ReadFileOptions,
  SearchOptions,
  SearchResult,
  WriteFileOptions,
  WriteResult,
} from '../../domain/cipher/file-system/types.js'

/**
 * Interface for file system operations.
 * Provides secure, validated access to the file system with comprehensive
 * path validation, size limits, and allow/block list enforcement.
 */
export interface IFileSystem {
  /**
   * Edit a file by replacing strings.
   * Supports single replacement (requires unique match) or replace-all.
   *
   * @param filePath - Path to the file (relative or absolute)
   * @param operation - Edit operation (old string, new string, replace-all flag)
   * @param options - Edit options (encoding)
   * @returns Edit result with replacements count and bytes written
   * @throws FileNotFoundError if file doesn't exist
   * @throws StringNotFoundError if old string not found
   * @throws StringNotUniqueError if old string appears multiple times (and replaceAll=false)
   */
  editFile(filePath: string, operation: EditOperation, options?: EditFileOptions): Promise<EditResult>

  /**
   * Find files matching a glob pattern.
   *
   * @param pattern - Glob pattern (e.g., src/\*\*\/\*.ts, \*.json)
   * @param options - Glob options (cwd, max results, metadata)
   * @returns Glob result with matched files and metadata
   * @throws InvalidPatternError if pattern is invalid
   */
  globFiles(pattern: string, options?: GlobOptions): Promise<GlobResult>

  /**
   * Initialize the file system service.
   * Performs setup and validation of configuration.
   */
  initialize(): Promise<void>

  /**
   * Read the contents of a file.
   *
   * @param filePath - Path to the file (relative or absolute)
   * @param options - Read options (pagination, encoding)
   * @returns File content with metadata
   * @throws FileNotFoundError if file doesn't exist
   * @throws PathNotAllowedError if path is not in allowed paths
   * @throws FileTooLargeError if file exceeds size limit
   */
  readFile(filePath: string, options?: ReadFileOptions): Promise<FileContent>

  /**
   * Search file contents for a pattern.
   * Supports regex patterns and context lines.
   *
   * @param pattern - Search pattern (regex)
   * @param options - Search options (glob filter, cwd, max results, context lines, case sensitivity)
   * @returns Search result with matches and context
   * @throws InvalidPatternError if pattern is invalid regex
   */
  searchContent(pattern: string, options?: SearchOptions): Promise<SearchResult>

  /**
   * Write content to a file.
   * Overwrites existing files. Can create parent directories if requested.
   *
   * @param filePath - Path to the file (relative or absolute)
   * @param content - Content to write
   * @param options - Write options (directory creation, encoding)
   * @returns Write result with path and bytes written
   * @throws PathNotAllowedError if path is not in allowed paths
   * @throws InvalidExtensionError if file has blocked extension
   */
  writeFile(filePath: string, content: string, options?: WriteFileOptions): Promise<WriteResult>
}
