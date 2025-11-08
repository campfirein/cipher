import fs from 'node:fs/promises'
import path from 'node:path'

import {glob} from 'glob'

import {
  DirectoryNotFoundError,
  EditOperationError,
  FileNotFoundError,
  FileTooLargeError,
  GlobOperationError,
  InvalidExtensionError,
  InvalidPathError,
  InvalidPatternError,
  PathBlockedError,
  PathNotAllowedError,
  PathTraversalError,
  ReadOperationError,
  SearchOperationError,
  ServiceNotInitializedError,
  StringNotFoundError,
  StringNotUniqueError,
  WriteOperationError,
} from '../../core/domain/errors/file-system-error.js'
import type {
  EditFileOptions,
  EditOperation,
  EditResult,
  FileContent,
  FileMetadata,
  FileSystemConfig,
  GlobOptions,
  GlobResult,
  ReadFileOptions,
  SearchMatch,
  SearchOptions,
  SearchResult,
  WriteFileOptions,
  WriteResult,
} from '../../core/domain/file-system/types.js'
import type {IFileSystem} from '../../core/interfaces/i-file-system.js'
import {PathValidator} from './path-validator.js'

/**
 * File system service implementation.
 * Provides secure, validated file system operations with comprehensive
 * path validation, size limits, and allow/block list enforcement.
 */
export class FileSystemService implements IFileSystem {
  private readonly config: Required<FileSystemConfig>
  private readonly pathValidator: PathValidator
  private initialized: boolean = false

  /**
   * Creates a new file system service
   * @param config - File system configuration (optional, uses defaults)
   */
  public constructor(config: Partial<FileSystemConfig> = {}) {
    // Merge with defaults
    this.config = {
      allowedPaths: config.allowedPaths ?? ['.'],
      blockedExtensions: config.blockedExtensions ?? ['.exe', '.dll', '.so', '.dylib'],
      blockedPaths: config.blockedPaths ?? ['.git', 'node_modules/.bin', '.env', '.byterover'],
      maxFileSize: config.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      workingDirectory: config.workingDirectory ?? process.cwd(),
    }

    this.pathValidator = new PathValidator(this.config)
  }

  /**
   * Initialize the file system service.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // Verify working directory exists
    try {
      const stats = await fs.stat(this.config.workingDirectory)
      if (!stats.isDirectory()) {
        throw new DirectoryNotFoundError(this.config.workingDirectory)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new DirectoryNotFoundError(this.config.workingDirectory)
      }
      throw error
    }

    this.initialized = true
  }

  /**
   * Read the contents of a file.
   */
  public async readFile(filePath: string, options: ReadFileOptions = {}): Promise<FileContent> {
    this.ensureInitialized()

    // Validate path
    const validation = this.pathValidator.validate(filePath, 'read')
    if (!validation.valid || !validation.normalizedPath) {
      this.throwValidationError(filePath, validation.error!)
    }

    const normalizedPath = validation.normalizedPath

    try {
      // Check if file exists
      let stats
      try {
        stats = await fs.stat(normalizedPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new FileNotFoundError(normalizedPath)
        }
        throw error
      }

      // Check file size
      if (stats.size > this.config.maxFileSize) {
        throw new FileTooLargeError(normalizedPath, stats.size, this.config.maxFileSize)
      }

      // Read file
      const encoding = (options.encoding ?? 'utf8') as BufferEncoding
      const content = await fs.readFile(normalizedPath, encoding)

      // Handle pagination
      const lines = content.split('\n')

      let selectedLines: string[]
      let truncated = false

      // Apply offset (1-based, like text editors)
      const offset1 = options.offset
      const limit = options.limit

      if (offset1 !== undefined || limit !== undefined) {
        const start = offset1 && offset1 > 0 ? Math.max(0, offset1 - 1) : 0
        const end = limit !== undefined ? start + limit : lines.length

        selectedLines = lines.slice(start, end)
        truncated = end < lines.length
      } else {
        selectedLines = lines
      }

      const selectedContent = selectedLines.join('\n')

      return {
        content: selectedContent,
        encoding,
        lines: selectedLines.length,
        size: stats.size,
        truncated,
      }
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof FileNotFoundError ||
        error instanceof FileTooLargeError ||
        error instanceof PathNotAllowedError ||
        error instanceof PathTraversalError ||
        error instanceof PathBlockedError
      ) {
        throw error
      }

      // Wrap other errors
      throw new ReadOperationError(normalizedPath, (error as Error).message)
    }
  }

  /**
   * Write content to a file.
   */
  public async writeFile(
    filePath: string,
    content: string,
    options: WriteFileOptions = {},
  ): Promise<WriteResult> {
    this.ensureInitialized()

    // Validate path
    const validation = this.pathValidator.validate(filePath, 'write')
    if (!validation.valid || !validation.normalizedPath) {
      this.throwValidationError(filePath, validation.error!)
    }

    const normalizedPath = validation.normalizedPath

    try {
      // Create parent directories if requested
      if (options.createDirs) {
        const dirname = path.dirname(normalizedPath)
        await fs.mkdir(dirname, {recursive: true})
      }

      // Write file
      const encoding = (options.encoding ?? 'utf8') as BufferEncoding
      await fs.writeFile(normalizedPath, content, encoding)

      // Get file size
      const stats = await fs.stat(normalizedPath)

      return {
        bytesWritten: stats.size,
        path: normalizedPath,
        success: true,
      }
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof InvalidExtensionError ||
        error instanceof PathNotAllowedError ||
        error instanceof PathTraversalError ||
        error instanceof PathBlockedError
      ) {
        throw error
      }

      // Wrap other errors
      throw new WriteOperationError(normalizedPath, (error as Error).message)
    }
  }

  /**
   * Edit a file by replacing strings.
   */
  public async editFile(
    filePath: string,
    operation: EditOperation,
    options: EditFileOptions = {},
  ): Promise<EditResult> {
    this.ensureInitialized()

    // Validate path
    const validation = this.pathValidator.validate(filePath, 'read')
    if (!validation.valid || !validation.normalizedPath) {
      this.throwValidationError(filePath, validation.error!)
    }

    const normalizedPath = validation.normalizedPath

    try {
      // Read current content
      const fileContent = await this.readFile(filePath, options)
      let {content} = fileContent

      // Escape regex special characters for literal string matching
      const escapedOldString = operation.oldString.replaceAll(
        /[$()*+.?[\\\]^{|}]/g,
        '\\$&',
      )

      // Count occurrences
      const occurrences = (content.match(new RegExp(escapedOldString, 'g')) || []).length

      // Check if string exists
      if (occurrences === 0) {
        throw new StringNotFoundError(normalizedPath, operation.oldString)
      }

      // Check if string is unique (if replaceAll is false)
      if (!operation.replaceAll && occurrences > 1) {
        throw new StringNotUniqueError(normalizedPath, operation.oldString, occurrences)
      }

      // Perform replacement
      if (operation.replaceAll) {
        content = content.replaceAll(operation.oldString, operation.newString)
      } else {
        // Replace only the first occurrence
        content = content.replace(operation.oldString, operation.newString)
      }

      // Write back
      const writeResult = await this.writeFile(filePath, content, options)

      return {
        bytesWritten: writeResult.bytesWritten,
        path: normalizedPath,
        replacements: operation.replaceAll ? occurrences : 1,
        success: true,
      }
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof FileNotFoundError ||
        error instanceof StringNotFoundError ||
        error instanceof StringNotUniqueError ||
        error instanceof PathNotAllowedError ||
        error instanceof PathTraversalError ||
        error instanceof PathBlockedError
      ) {
        throw error
      }

      // Wrap other errors
      throw new EditOperationError(normalizedPath, (error as Error).message)
    }
  }

  /**
   * Find files matching a glob pattern.
   */
  public async globFiles(pattern: string, options: GlobOptions = {}): Promise<GlobResult> {
    this.ensureInitialized()

    const cwd = options.cwd ?? this.config.workingDirectory
    const maxResults = options.maxResults ?? 1000
    const includeMetadata = options.includeMetadata ?? true

    try {
      // Execute glob
      const files = await glob(pattern, {
        absolute: true,
        cwd,
        follow: false, // Don't follow symlinks
        nodir: true, // Only files
      })

      // Validate and collect file metadata
      const validFiles: FileMetadata[] = []
      let totalFound = 0

      for (const file of files) {
        totalFound++

        // Validate path
        const validation = this.pathValidator.validate(file, 'read')
        if (!validation.valid || !validation.normalizedPath) {
          // Skip invalid paths
          continue
        }

        // Check if we've reached the limit
        if (validFiles.length >= maxResults) {
          break
        }

        // Collect metadata if requested
        if (includeMetadata) {
          try {
            const stats = await fs.stat(validation.normalizedPath)
            validFiles.push({
              isDirectory: stats.isDirectory(),
              modified: stats.mtime,
              path: validation.normalizedPath,
              size: stats.size,
            })
          } catch {
            // Skip files that can't be stat'd
            continue
          }
        } else {
          validFiles.push({
            isDirectory: false,
            modified: new Date(),
            path: validation.normalizedPath,
            size: 0,
          })
        }
      }

      return {
        files: validFiles,
        totalFound,
        truncated: totalFound > maxResults,
      }
    } catch (error) {
      // Check for pattern errors
      if ((error as Error).message.includes('Invalid glob pattern')) {
        throw new InvalidPatternError(pattern, (error as Error).message)
      }

      throw new GlobOperationError(pattern, (error as Error).message)
    }
  }

  /**
   * Search file contents for a pattern.
   */
  public async searchContent(
    pattern: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    this.ensureInitialized()

    const globPattern = options.globPattern ?? '**/*'
    const cwd = options.cwd ?? this.config.workingDirectory
    const maxResults = options.maxResults ?? 100
    const contextLines = options.contextLines ?? 0
    const caseInsensitive = options.caseInsensitive ?? false

    try {
      // Create regex
      const flags = caseInsensitive ? 'i' : ''
      let regex: RegExp
      try {
        regex = new RegExp(pattern, flags)
      } catch (error) {
        throw new InvalidPatternError(pattern, (error as Error).message)
      }

      // Find files to search
      const globResult = await this.globFiles(globPattern, {
        cwd,
        includeMetadata: false,
        maxResults: 10000, // Search more files, but limit results
      })

      const matches: SearchMatch[] = []
      let totalMatches = 0
      let filesSearched = 0

      // Search each file
      for (const fileInfo of globResult.files) {
        filesSearched++

        try {
          // Read file
          // eslint-disable-next-line no-await-in-loop
          const fileContent = await this.readFile(fileInfo.path)
          const lines = fileContent.content.split('\n')

          // Search lines
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]

            if (regex.test(line)) {
              totalMatches++

              // Check if we've reached the limit
              if (matches.length >= maxResults) {
                return {
                  filesSearched,
                  matches,
                  totalMatches,
                  truncated: true,
                }
              }

              // Collect context lines
              const before: string[] = []
              const after: string[] = []

              if (contextLines > 0) {
                // Lines before
                for (let j = Math.max(0, i - contextLines); j < i; j++) {
                  before.push(lines[j])
                }

                // Lines after
                for (let j = i + 1; j < Math.min(lines.length, i + 1 + contextLines); j++) {
                  after.push(lines[j])
                }
              }

              matches.push({
                context: contextLines > 0 ? {after, before} : undefined,
                file: fileInfo.path,
                line,
                lineNumber: i + 1, // 1-based line numbers
              })
            }
          }
        } catch {
          // Skip files that can't be read
          continue
        }
      }

      return {
        filesSearched,
        matches,
        totalMatches,
        truncated: false,
      }
    } catch (error) {
      // Re-throw known errors
      if (error instanceof InvalidPatternError || error instanceof GlobOperationError) {
        throw error
      }

      throw new SearchOperationError(pattern, (error as Error).message)
    }
  }

  /**
   * Ensures the service is initialized.
   * @throws ServiceNotInitializedError if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ServiceNotInitializedError()
    }
  }

  /**
   * Throws the appropriate error based on validation error message.
   */
  private throwValidationError(path: string, error: string): never {
    if (error.includes('empty')) {
      throw new InvalidPathError(path, error)
    }
    if (error.includes('traversal')) {
      throw new PathTraversalError(path)
    }
    if (error.includes('not in allowed paths')) {
      throw new PathNotAllowedError(path, this.config.allowedPaths)
    }
    if (error.includes('blocked')) {
      throw new PathBlockedError(path, error)
    }
    if (error.includes('extension')) {
      const ext = path.split('.').pop() ?? ''
      throw new InvalidExtensionError(path, ext)
    }

    // Fallback
    throw new InvalidPathError(path, error)
  }
}