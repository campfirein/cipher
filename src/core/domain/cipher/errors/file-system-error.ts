/**
 * Base error class for file system operations.
 * All file system-specific errors extend this base class.
 */
export class FileSystemError extends Error {
  public readonly code: string
  public readonly details?: Record<string, unknown>

  /**
   * Creates a new file system error
   * @param message - Error message describing what went wrong
   * @param code - Error code for categorization
   * @param details - Additional error context
   */
  public constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'FileSystemError'
    this.code = code
    this.details = details
  }
}

/**
 * Error thrown when a file is not found.
 */
export class FileNotFoundError extends FileSystemError {
  /**
   * Creates a new file not found error
   * @param path - Path to the file that was not found
   * @param customMessage - Optional custom message (e.g., with suggestions)
   */
  public constructor(path: string, customMessage?: string) {
    super(customMessage ?? `File not found: ${path}`, 'FILE_NOT_FOUND', {path})
    this.name = 'FileNotFoundError'
  }
}

/**
 * Error thrown when a directory is not found.
 */
export class DirectoryNotFoundError extends FileSystemError {
  /**
   * Creates a new directory not found error
   * @param path - Path to the directory that was not found
   */
  public constructor(path: string) {
    super(`Directory not found: ${path}`, 'DIRECTORY_NOT_FOUND', {path})
    this.name = 'DirectoryNotFoundError'
  }
}

/**
 * Error thrown when a path is not in the allowed paths list.
 */
export class PathNotAllowedError extends FileSystemError {
  /**
   * Creates a new path not allowed error
   * @param path - Path that was not allowed
   * @param allowedPaths - List of allowed paths
   */
  public constructor(path: string, allowedPaths: string[]) {
    super(
      `Path not allowed: ${path}. Allowed paths: ${allowedPaths.join(', ')}`,
      'PATH_NOT_ALLOWED',
      {allowedPaths, path},
    )
    this.name = 'PathNotAllowedError'
  }
}

/**
 * Error thrown when a path is in the blocked paths list.
 */
export class PathBlockedError extends FileSystemError {
  /**
   * Creates a new path blocked error
   * @param path - Path that was blocked
   * @param reason - Reason why the path was blocked
   */
  public constructor(path: string, reason: string) {
    super(`Path blocked: ${path}. Reason: ${reason}`, 'PATH_BLOCKED', {path, reason})
    this.name = 'PathBlockedError'
  }
}

/**
 * Error thrown when path traversal is detected.
 */
export class PathTraversalError extends FileSystemError {
  /**
   * Creates a new path traversal error
   * @param path - Path that contained traversal attempt
   */
  public constructor(path: string) {
    super(
      `Path traversal detected: ${path}. Relative paths with ".." are not allowed`,
      'PATH_TRAVERSAL',
      {path},
    )
    this.name = 'PathTraversalError'
  }
}

/**
 * Error thrown when a file has a blocked extension.
 */
export class InvalidExtensionError extends FileSystemError {
  /**
   * Creates a new invalid extension error
   * @param path - Path with invalid extension
   * @param extension - The blocked extension
   */
  public constructor(path: string, extension: string) {
    super(`Invalid file extension: ${extension} in ${path}`, 'INVALID_EXTENSION', {extension, path})
    this.name = 'InvalidExtensionError'
  }
}

/**
 * Error thrown when a file exceeds the maximum size limit.
 */
export class FileTooLargeError extends FileSystemError {
  /**
   * Creates a new file too large error
   * @param path - Path to the file that is too large
   * @param size - Actual file size in bytes
   * @param maxSize - Maximum allowed size in bytes
   */
  public constructor(path: string, size: number, maxSize: number) {
    super(
      `File too large: ${path} (${size} bytes). Maximum allowed: ${maxSize} bytes`,
      'FILE_TOO_LARGE',
      {maxSize, path, size},
    )
    this.name = 'FileTooLargeError'
  }
}

/**
 * Error thrown when a read operation fails.
 */
export class ReadOperationError extends FileSystemError {
  /**
   * Creates a new read operation error
   * @param path - Path to the file that failed to read
   * @param originalError - The original error message
   */
  public constructor(path: string, originalError: string) {
    super(`Failed to read file: ${path}. Error: ${originalError}`, 'READ_OPERATION_FAILED', {
      originalError,
      path,
    })
    this.name = 'ReadOperationError'
  }
}

/**
 * Error thrown when a write operation fails.
 */
export class WriteOperationError extends FileSystemError {
  /**
   * Creates a new write operation error
   * @param path - Path to the file that failed to write
   * @param originalError - The original error message
   */
  public constructor(path: string, originalError: string) {
    super(`Failed to write file: ${path}. Error: ${originalError}`, 'WRITE_OPERATION_FAILED', {
      originalError,
      path,
    })
    this.name = 'WriteOperationError'
  }
}

/**
 * Error thrown when an edit operation fails.
 */
export class EditOperationError extends FileSystemError {
  /**
   * Creates a new edit operation error
   * @param path - Path to the file that failed to edit
   * @param originalError - The original error message
   */
  public constructor(path: string, originalError: string) {
    super(`Failed to edit file: ${path}. Error: ${originalError}`, 'EDIT_OPERATION_FAILED', {
      originalError,
      path,
    })
    this.name = 'EditOperationError'
  }
}

/**
 * Error thrown when a string to replace is not found in the file.
 */
export class StringNotFoundError extends FileSystemError {
  /**
   * Creates a new string not found error
   * @param path - Path to the file
   * @param searchString - The string that was not found
   */
  public constructor(path: string, searchString: string) {
    super(`String not found in ${path}: "${searchString}"`, 'STRING_NOT_FOUND', {
      path,
      searchString,
    })
    this.name = 'StringNotFoundError'
  }
}

/**
 * Error thrown when a string to replace appears multiple times but replaceAll is false.
 */
export class StringNotUniqueError extends FileSystemError {
  /**
   * Creates a new string not unique error
   * @param path - Path to the file
   * @param searchString - The non-unique string
   * @param occurrences - Number of times the string appears
   */
  public constructor(path: string, searchString: string, occurrences: number) {
    super(
      `String not unique in ${path}: "${searchString}" (found ${occurrences} times). Use replaceAll: true to replace all occurrences`,
      'STRING_NOT_UNIQUE',
      {occurrences, path, searchString},
    )
    this.name = 'StringNotUniqueError'
  }
}

/**
 * Error thrown when a glob pattern is invalid.
 */
export class InvalidPatternError extends FileSystemError {
  /**
   * Creates a new invalid pattern error
   * @param pattern - The invalid pattern
   * @param originalError - The original error message
   */
  public constructor(pattern: string, originalError: string) {
    super(`Invalid pattern: ${pattern}. Error: ${originalError}`, 'INVALID_PATTERN', {
      originalError,
      pattern,
    })
    this.name = 'InvalidPatternError'
  }
}

/**
 * Error thrown when glob operation fails.
 */
export class GlobOperationError extends FileSystemError {
  /**
   * Creates a new glob operation error
   * @param pattern - The glob pattern that failed
   * @param originalError - The original error message
   */
  public constructor(pattern: string, originalError: string) {
    super(`Glob operation failed for pattern: ${pattern}. Error: ${originalError}`, 'GLOB_OPERATION_FAILED', {
      originalError,
      pattern,
    })
    this.name = 'GlobOperationError'
  }
}

/**
 * Error thrown when search operation fails.
 */
export class SearchOperationError extends FileSystemError {
  /**
   * Creates a new search operation error
   * @param pattern - The search pattern that failed
   * @param originalError - The original error message
   */
  public constructor(pattern: string, originalError: string) {
    super(`Search operation failed for pattern: ${pattern}. Error: ${originalError}`, 'SEARCH_OPERATION_FAILED', {
      originalError,
      pattern,
    })
    this.name = 'SearchOperationError'
  }
}

/**
 * Error thrown when the service is not initialized.
 */
export class ServiceNotInitializedError extends FileSystemError {
  /**
   * Creates a new service not initialized error
   */
  public constructor() {
    super(
      'FileSystemService not initialized. Call initialize() before using the service',
      'SERVICE_NOT_INITIALIZED',
    )
    this.name = 'ServiceNotInitializedError'
  }
}

/**
 * Error thrown when the path is empty or invalid.
 */
export class InvalidPathError extends FileSystemError {
  /**
   * Creates a new invalid path error
   * @param path - The invalid path
   * @param reason - Reason why the path is invalid
   */
  public constructor(path: string, reason: string) {
    super(`Invalid path: ${path}. Reason: ${reason}`, 'INVALID_PATH', {path, reason})
    this.name = 'InvalidPathError'
  }
}

/**
 * Error thrown when too many results are found.
 */
export class TooManyResultsError extends FileSystemError {
  /**
   * Creates a new too many results error
   * @param operation - The operation that produced too many results
   * @param count - Number of results found
   * @param maxResults - Maximum allowed results
   */
  public constructor(operation: string, count: number, maxResults: number) {
    super(
      `Too many results for ${operation}: found ${count}, maximum allowed: ${maxResults}. Narrow your search or increase maxResults`,
      'TOO_MANY_RESULTS',
      {count, maxResults, operation},
    )
    this.name = 'TooManyResultsError'
  }
}

/**
 * Error thrown when PDF text extraction fails.
 */
export class PdfExtractionError extends FileSystemError {
  /**
   * Creates a new PDF extraction error
   * @param path - Path to the PDF file
   * @param reason - Reason for the extraction failure
   */
  public constructor(path: string, reason: string) {
    super(`Failed to extract text from PDF: ${path}. ${reason}`, 'PDF_EXTRACTION_FAILED', {
      path,
      reason,
    })
    this.name = 'PdfExtractionError'
  }
}

/**
 * Error thrown when a PDF has no extractable text (scanned/image-only PDFs).
 */
export class PdfNoTextError extends FileSystemError {
  /**
   * Creates a new PDF no text error
   * @param path - Path to the PDF file
   * @param pageCount - Number of pages in the PDF
   */
  public constructor(path: string, pageCount: number) {
    super(
      `PDF has no extractable text: ${path} (${pageCount} pages). This PDF may be scanned or contain only images.`,
      'PDF_NO_TEXT',
      { pageCount, path },
    )
    this.name = 'PdfNoTextError'
  }
}