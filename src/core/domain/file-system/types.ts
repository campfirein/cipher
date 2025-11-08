/**
 * Configuration for the file system service.
 * Defines security policies and operational limits.
 */
export interface FileSystemConfig {
  /** Whitelist of allowed base paths (relative to working directory) */
  allowedPaths: string[]

  /** Blacklist of forbidden paths (e.g., .git, node_modules/.bin) */
  blockedPaths: string[]

  /** Blacklist of forbidden file extensions (e.g., .exe, .dll) */
  blockedExtensions: string[]

  /** Maximum file size in bytes for read operations */
  maxFileSize: number

  /** Working directory for relative path resolution */
  workingDirectory: string
}

/**
 * Options for reading files.
 */
export interface ReadFileOptions {
  /** Maximum number of lines to read */
  limit?: number

  /** Starting line number (1-based, like text editors) */
  offset?: number

  /** Character encoding */
  encoding?: BufferEncoding
}

/**
 * Options for writing files.
 */
export interface WriteFileOptions {
  /** Create parent directories if they don't exist */
  createDirs?: boolean

  /** Character encoding */
  encoding?: BufferEncoding
}

/**
 * Options for editing files.
 */
export interface EditFileOptions {
  /** Character encoding */
  encoding?: BufferEncoding
}

/**
 * Options for glob file discovery.
 */
export interface GlobOptions {
  /** Working directory for glob pattern */
  cwd?: string

  /** Maximum number of results to return */
  maxResults?: number

  /** Include file metadata (size, modified date) */
  includeMetadata?: boolean
}

/**
 * Options for content search.
 */
export interface SearchOptions {
  /** Glob pattern to filter files (default: all files) */
  globPattern?: string

  /** Working directory for search */
  cwd?: string

  /** Maximum number of matches to return */
  maxResults?: number

  /** Number of context lines before/after match */
  contextLines?: number

  /** Case-insensitive search */
  caseInsensitive?: boolean
}

/**
 * Result of a file read operation.
 */
export interface FileContent {
  /** File content as string */
  content: string

  /** Total number of lines in the returned content */
  lines: number

  /** Character encoding used */
  encoding: string

  /** Whether content was truncated due to size/line limits */
  truncated: boolean

  /** File size in bytes */
  size: number
}

/**
 * Result of a file write operation.
 */
export interface WriteResult {
  /** Whether the write was successful */
  success: boolean

  /** Absolute path to the written file */
  path: string

  /** Number of bytes written */
  bytesWritten: number
}

/**
 * Result of a file edit operation.
 */
export interface EditResult {
  /** Whether the edit was successful */
  success: boolean

  /** Absolute path to the edited file */
  path: string

  /** Number of replacements made */
  replacements: number

  /** Number of bytes written */
  bytesWritten: number
}

/**
 * Metadata about a file.
 */
export interface FileMetadata {
  /** Absolute path to the file */
  path: string

  /** File size in bytes */
  size: number

  /** Last modified date */
  modified: Date

  /** Whether this is a directory */
  isDirectory: boolean
}

/**
 * Result of a glob file discovery operation.
 */
export interface GlobResult {
  /** Array of matching files with metadata */
  files: FileMetadata[]

  /** Whether results were truncated due to maxResults limit */
  truncated: boolean

  /** Total number of files found (before truncation) */
  totalFound: number
}

/**
 * A single search match with context.
 */
export interface SearchMatch {
  /** File path where match was found */
  file: string

  /** Line number (1-based) */
  lineNumber: number

  /** Matching line content */
  line: string

  /** Context lines before and after the match */
  context?: {
    /** Lines before the match */
    before: string[]

    /** Lines after the match */
    after: string[]
  }
}

/**
 * Result of a content search operation.
 */
export interface SearchResult {
  /** Array of matches */
  matches: SearchMatch[]

  /** Total number of matches found */
  totalMatches: number

  /** Whether results were truncated due to maxResults limit */
  truncated: boolean

  /** Number of files searched */
  filesSearched: number
}

/**
 * Edit operation definition.
 */
export interface EditOperation {
  /** String to search for */
  oldString: string

  /** String to replace with */
  newString: string

  /** Replace all occurrences (default: false, requires unique match) */
  replaceAll?: boolean
}

/**
 * Result of path validation.
 */
export interface ValidationResult {
  /** Whether the path is valid */
  valid: boolean

  /** Normalized absolute path (if valid) */
  normalizedPath?: string

  /** Error message (if invalid) */
  error?: string
}