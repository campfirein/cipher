/**
 * Buffer encoding type from Node.js
 */
export type BufferEncoding =
  | 'ascii'
  | 'base64'
  | 'base64url'
  | 'binary'
  | 'hex'
  | 'latin1'
  | 'ucs2'
  | 'ucs-2'
  | 'utf8'
  | 'utf16le'

/**
 * Configuration for the file system service.
 * Defines security policies and operational limits.
 */
export interface FileSystemConfig {
  /** Whitelist of allowed base paths (relative to working directory) */
  allowedPaths: string[]

  /** Blacklist of forbidden file extensions (e.g., .exe, .dll) */
  blockedExtensions: string[]

  /** Blacklist of forbidden paths (e.g., .git, node_modules/.bin) */
  blockedPaths: string[]

  /** Maximum file size in bytes for read operations */
  maxFileSize: number

  /** Working directory for relative path resolution */
  workingDirectory: string
}

/**
 * PDF read mode for controlling how PDF files are returned.
 * - 'text': Extract text content page by page (default)
 * - 'base64': Return raw PDF as base64 attachment (for multimodal LLMs)
 */
export type PdfReadMode = 'base64' | 'text'

/**
 * Metadata extracted from a PDF file.
 */
export interface PdfMetadata {
  /** Author of the PDF (if available) */
  author?: string

  /** Creation date of the PDF (if available) */
  creationDate?: Date

  /** Total number of pages in the PDF */
  pageCount: number

  /** Title of the PDF (if available) */
  title?: string
}

/**
 * Content extracted from a single PDF page.
 */
export interface PdfPageContent {
  /** 1-based page number */
  pageNumber: number

  /** Extracted text content from the page */
  text: string
}

/**
 * Options for reading files.
 */
export interface ReadFileOptions {
  /** Character encoding */
  encoding?: BufferEncoding

  /** Maximum number of lines to read (for text files) or pages (for PDFs in text mode) */
  limit?: number

  /** Starting line number (1-based) for text files, or starting page number for PDFs */
  offset?: number

  /** PDF read mode: 'text' (default) extracts text, 'base64' returns raw attachment */
  pdfMode?: PdfReadMode
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
  /** Case-sensitive pattern matching (default: true) */
  caseSensitive?: boolean

  /** Working directory for glob pattern */
  cwd?: string

  /** Include file metadata (size, modified date) */
  includeMetadata?: boolean

  /** Maximum number of results to return */
  maxResults?: number

  /** Respect .gitignore rules when matching files (default: true) */
  respectGitignore?: boolean
}

/**
 * Options for content search.
 */
export interface SearchOptions {
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal

  /** Case-insensitive search */
  caseInsensitive?: boolean

  /** Number of context lines before/after match */
  contextLines?: number

  /** Working directory for search */
  cwd?: string

  /** Glob pattern to filter files (default: all files) */
  globPattern?: string

  /** Maximum number of matches to return */
  maxResults?: number
}

/**
 * Options for listing directory contents.
 */
export interface ListDirectoryOptions {
  /** Additional glob patterns to ignore (merged with defaults) */
  ignore?: string[]

  /** Maximum number of files to return (default: 100) */
  maxResults?: number
}

/**
 * Entry in directory listing.
 */
export interface DirectoryEntry {
  /** Whether this is a directory */
  isDirectory: boolean

  /** Entry name (file or directory name, not full path) */
  name: string

  /** Relative path from the listed directory */
  path: string
}

/**
 * Result of a directory listing operation.
 */
export interface ListDirectoryResult {
  /** Total number of entries found */
  count: number

  /** Array of directory entries */
  entries: DirectoryEntry[]

  /** Formatted tree output string */
  tree: string

  /** Whether results were truncated */
  truncated: boolean
}

/**
 * Attachment data for binary files (images, PDFs).
 * Used to return base64-encoded content for multimodal LLM consumption.
 */
export interface FileAttachment {
  /** Base64-encoded file content */
  base64: string

  /** Original file name */
  fileName: string

  /** MIME type (e.g., 'image/png', 'application/pdf') */
  mimeType: string
}

/**
 * Result of a file read operation.
 */
export interface FileContent {
  /** Attachment data for binary files (images, PDFs in base64 mode) */
  attachment?: FileAttachment

  /** File content as string */
  content: string

  /** Character encoding used */
  encoding: string

  /** Formatted content with line numbers (00001| content format) or PDF page separators */
  formattedContent: string

  /** Total number of lines in the returned content (or pages for PDF text mode) */
  lines: number

  /** Human-readable message about file status (truncation info, etc.) */
  message: string

  /** PDF metadata when reading PDF in text mode */
  pdfMetadata?: PdfMetadata

  /** PDF page contents when reading PDF in text mode */
  pdfPages?: PdfPageContent[]

  /** Preview of content (first 20 lines) for UI display */
  preview?: string

  /** File size in bytes */
  size: number

  /** Total lines in the entire file (or total pages for PDF text mode) */
  totalLines: number

  /** Whether content was truncated due to size/line limits */
  truncated: boolean

  /** Number of lines that were truncated due to excessive length */
  truncatedLineCount?: number
}

/**
 * Result of a file write operation.
 */
export interface WriteResult {
  /** Number of bytes written */
  bytesWritten: number

  /** Absolute path to the written file */
  path: string

  /** Whether the write was successful */
  success: boolean
}

/**
 * Result of a file edit operation.
 */
export interface EditResult {
  /** Number of bytes written */
  bytesWritten: number

  /** Absolute path to the edited file */
  path: string

  /** Number of replacements made */
  replacements: number

  /** Whether the edit was successful */
  success: boolean
}

/**
 * Metadata about a file.
 */
export interface FileMetadata {
  /** Whether this is a directory */
  isDirectory: boolean

  /** Last modified date */
  modified: Date

  /** Absolute path to the file */
  path: string

  /** File size in bytes */
  size: number
}

/**
 * Result of a glob file discovery operation.
 */
export interface GlobResult {
  /** Array of matching files with metadata */
  files: FileMetadata[]

  /** Number of files ignored due to .gitignore rules */
  ignoredCount: number

  /** Human-readable message describing the results */
  message?: string

  /** Total number of files found (before truncation) */
  totalFound: number

  /** Whether results were truncated due to maxResults limit */
  truncated: boolean
}

/**
 * A single search match with context.
 */
export interface SearchMatch {
  /** Context lines before and after the match */
  context?: {
    /** Lines after the match */
    after: string[]

    /** Lines before the match */
    before: string[]
  }

  /** File path where match was found */
  file: string

  /** Matching line content */
  line: string

  /** Line number (1-based) */
  lineNumber: number

  /** File modification time in milliseconds (for sorting by recency) */
  mtime?: number
}

/**
 * Result of a content search operation.
 */
export interface SearchResult {
  /** Number of files searched */
  filesSearched: number

  /** Array of matches */
  matches: SearchMatch[]

  /** Total number of matches found */
  totalMatches: number

  /** Whether results were truncated due to maxResults limit */
  truncated: boolean
}

/**
 * Edit operation definition.
 */
export interface EditOperation {
  /** String to replace with */
  newString: string

  /** String to search for */
  oldString: string

  /** Replace all occurrences (default: false, requires unique match) */
  replaceAll?: boolean
}

/**
 * Result of path validation.
 * Uses discriminated union for type safety.
 */
export type ValidationResult =
  | {
      /** Error message explaining why path is invalid */
      error: string
      /** Path is invalid */
      valid: false
    }
  | {
      /** Normalized absolute path */
      normalizedPath: string
      /** Path is valid */
      valid: true
    }
