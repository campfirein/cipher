/**
 * Configuration options for folder packing operations.
 * Controls which files to include, exclude, and how to process them.
 */
export interface FolderPackConfig {
  /** Whether to extract text from Office documents (docx, xlsx, pptx). Default: false */
  extractDocuments: boolean

  /** Whether to extract text from PDF files. Default: true */
  extractPdfText: boolean

  /** Additional glob patterns to ignore (merged with defaults) */
  ignore: string[]

  /** Glob patterns for files to include. Default: all files */
  include: string[]

  /** Whether to include directory tree in the output. Default: true */
  includeTree: boolean

  /** Maximum file size in bytes to include. Default: 10MB */
  maxFileSize: number

  /** Maximum number of lines to read per file. Default: 10000 */
  maxLinesPerFile: number

  /** Whether to respect .gitignore rules. Default: true */
  useGitignore: boolean
}

/**
 * Reasons why a file might be skipped during packing.
 */
export type SkipReason = 'binary' | 'encoding' | 'permission' | 'read-error' | 'size-limit'

/**
 * Represents a single packed file with its content and metadata.
 */
export interface PackedFile {
  /** File content as string */
  content: string

  /** Detected file type (e.g., 'pdf', 'code', 'text') */
  fileType?: string

  /** Number of lines in the content */
  lineCount: number

  /** Relative path from the root folder */
  path: string

  /** File size in bytes */
  size: number

  /** Whether the content was truncated */
  truncated: boolean
}

/**
 * Represents a file that was skipped during packing.
 */
export interface SkippedFile {
  /** Optional error message with details */
  message?: string

  /** Relative path from the root folder */
  path: string

  /** Reason why the file was skipped */
  reason: SkipReason
}

/**
 * Result of a folder packing operation.
 */
export interface FolderPackResult {
  /** Configuration used for this pack operation */
  config: FolderPackConfig

  /** Directory tree representation */
  directoryTree: string

  /** Processing duration in milliseconds */
  durationMs: number

  /** Number of files successfully packed */
  fileCount: number

  /** Array of successfully packed files */
  files: PackedFile[]

  /** Absolute path to the root folder that was packed */
  rootPath: string

  /** Number of files skipped */
  skippedCount: number

  /** Array of files that were skipped */
  skippedFiles: SkippedFile[]

  /** Total character count across all packed files */
  totalCharacters: number

  /** Total line count across all packed files */
  totalLines: number
}

/**
 * Progress phases during folder packing.
 */
export type PackPhase = 'collecting' | 'generating' | 'searching'

/**
 * Progress information during folder packing.
 * Used for streaming progress updates to the UI.
 */
export interface PackProgress {
  /** Number of items processed so far */
  current: number

  /** Human-readable progress message */
  message: string

  /** Current phase of the packing operation */
  phase: PackPhase

  /** Total number of items to process (if known) */
  total?: number
}

/**
 * Callback function for receiving progress updates.
 */
export type PackProgressCallback = (progress: PackProgress) => void
