import { glob } from 'glob'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { EOL } from 'node:os'
import path from 'node:path'

import type {
  BufferEncoding,
  DirectoryEntry,
  EditFileOptions,
  EditOperation,
  EditResult,
  FileContent,
  FileMetadata,
  FileSystemConfig,
  GlobOptions,
  GlobResult,
  ListDirectoryOptions,
  ListDirectoryResult,
  ReadFileOptions,
  SearchMatch,
  SearchOptions,
  SearchResult,
  WriteFileOptions,
  WriteResult,
} from '../types/file-system/types.js'
import type { IFileSystem } from '../interfaces/i-file-system.js'

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
} from '../types/errors/file-system-error.js'
import { getErrorMessage } from '../../utils/error-helpers.js'
import { getMimeType, isBinaryFile, isMediaFile, isPdfFile } from './binary-utils.js'
import { createGitignoreFilter } from './gitignore-filter.js'
import { collectFileMetadata, escapeIfExactMatch, extractPaths, sortFilesByRecency } from './glob-utils.js'
import { PathValidator } from './path-validator.js'

/**
 * Maximum line length for search results.
 * Prevents context overflow from minified files or long lines.
 */
const MAX_LINE_LENGTH = 2000

/**
 * Default number of lines to read when no limit specified.
 * Prevents context overflow while providing enough content.
 */
const DEFAULT_READ_LIMIT = 2000

/**
 * Number of lines to include in the preview.
 */
const PREVIEW_LINES = 20

/**
 * Buffer size for binary file detection (4KB sample).
 */
const BINARY_DETECTION_BUFFER_SIZE = 4096

/**
 * Whitelist of .env file patterns that are safe to read.
 * These are typically example/template files without real secrets.
 */
const ENV_WHITELIST = ['.env.sample', '.env.example', '.env.template', '.env.defaults']

/**
 * Truncates a line to MAX_LINE_LENGTH, adding ellipsis if truncated.
 */
function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) {
    return line
  }

  return line.slice(0, MAX_LINE_LENGTH) + '...'
}

/**
 * Formats content with line numbers in 00001| format.
 * @param lines - Array of lines to format
 * @param startLine - Starting line number (1-based)
 * @returns Formatted string with line numbers
 */
function formatWithLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, index) => {
      const lineNum = (startLine + index).toString().padStart(5, '0')
      return `${lineNum}| ${line}`
    })
    .join('\n')
}

/**
 * Finds similar files in a directory for "Did you mean?" suggestions.
 * @param dirPath - Directory to search in
 * @param fileName - File name to find similar matches for
 * @returns Array of suggested file paths (max 3)
 */
async function findSimilarFiles(dirPath: string, fileName: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath)
    const lowerFileName = fileName.toLowerCase()

    const suggestions = entries
      .filter((entry) => {
        const lowerEntry = entry.toLowerCase()
        return lowerEntry.includes(lowerFileName) || lowerFileName.includes(lowerEntry)
      })
      .slice(0, 3)
      .map((entry) => path.join(dirPath, entry))

    return suggestions
  } catch {
    return []
  }
}

/**
 * Default patterns to ignore when listing directories.
 * Common build artifacts, caches, and IDE directories.
 */
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/',
  '__pycache__/',
  '.git/',
  'dist/',
  'build/',
  'target/',
  'vendor/',
  'bin/',
  'obj/',
  '.idea/',
  '.vscode/',
  '.zig-cache/',
  'zig-out/',
  '.coverage/',
  'coverage/',
  'tmp/',
  'temp/',
  '.cache/',
  'cache/',
  'logs/',
  '.venv/',
  'venv/',
  'env/',
  '.byterover/',
]

/**
 * Maximum number of files for directory listing.
 */
const LIST_DIRECTORY_LIMIT = 100

/**
 * File system service implementation.
 * Provides secure, validated file system operations with comprehensive
 * path validation, size limits, and allow/block list enforcement.
 */
export class FileSystemService implements IFileSystem {
  /**
   * Maximum line length before truncation (2000 characters).
   */
  private static readonly MAX_LINE_LENGTH = 2000
  private readonly config: Required<FileSystemConfig>
  private initialized: boolean = false
  private readonly pathValidator: PathValidator

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
    if (!validation.valid) {
      this.throwValidationError(filePath, validation.error)
    }

    const { normalizedPath } = validation

    try {
      // Read current content
      const fileContent = await this.readFile(filePath, options)
      let { content } = fileContent

      // Escape regex special characters for literal string matching
      const escapedOldString = operation.oldString.replaceAll(/[$()*+.?[\u005C\]^{|}]/g, String.raw`\$&`)

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
      content = operation.replaceAll
        ? content.replaceAll(operation.oldString, operation.newString)
        : content.replace(operation.oldString, operation.newString)

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
      throw new EditOperationError(normalizedPath, getErrorMessage(error))
    }
  }

  /**
   * Find files matching a glob pattern.
   *
   * Features:
   * - Case sensitivity control via `caseSensitive` option
   * - Gitignore filtering via `respectGitignore` option
   * - Smart sorting: recent files (within 24h) first, then alphabetical
   * - Special character handling for paths with glob syntax
   */
  public async globFiles(pattern: string, options: GlobOptions = {}): Promise<GlobResult> {
    this.ensureInitialized()

    const cwd = options.cwd ?? this.config.workingDirectory
    const maxResults = options.maxResults ?? 1000
    const includeMetadata = options.includeMetadata ?? true
    const caseSensitive = options.caseSensitive ?? true
    const respectGitignore = options.respectGitignore ?? true

    try {
      // Handle special characters - escape pattern if it matches an existing file
      const escapedPattern = await escapeIfExactMatch(pattern, cwd)

      // Execute glob with case sensitivity option
      const files = await glob(escapedPattern, {
        absolute: true,
        cwd,
        follow: false, // Don't follow symlinks
        nocase: !caseSensitive, // Case insensitive if caseSensitive is false
        nodir: true, // Only files
      })

      // Initialize gitignore filter if requested
      let gitignoreFilter = null
      if (respectGitignore) {
        gitignoreFilter = await createGitignoreFilter(cwd)
      }

      // Validate paths and apply gitignore filtering
      const validPaths: string[] = []
      let ignoredCount = 0

      for (const file of files) {
        // Validate path
        const validation = this.pathValidator.validate(file, 'read')
        if (!validation.valid || !validation.normalizedPath) {
          // Skip invalid paths
          continue
        }

        // Apply gitignore filter if enabled
        if (gitignoreFilter) {
          const relativePath = path.relative(cwd, validation.normalizedPath)
          if (gitignoreFilter.isIgnored(relativePath)) {
            ignoredCount++
            continue
          }
        }

        validPaths.push(validation.normalizedPath)
      }

      const totalFound = validPaths.length

      // Collect metadata for all valid paths
      const filesWithMetadata = await collectFileMetadata(validPaths, cwd)

      // Sort files: recent files first (within 24h), then alphabetical
      const sortedFiles = sortFilesByRecency(filesWithMetadata)

      // Apply maxResults limit after sorting
      const truncated = sortedFiles.length > maxResults
      const limitedFiles = sortedFiles.slice(0, maxResults)

      // Convert to FileMetadata format
      const resultFiles: FileMetadata[] = includeMetadata
        ? limitedFiles.map((f) => ({
          isDirectory: false,
          modified: f.modifiedTime,
          path: f.path,
          size: f.size,
        }))
        : extractPaths(limitedFiles).map((p) => ({
          isDirectory: false,
          modified: new Date(),
          path: p,
          size: 0,
        }))

      // Build result message
      const message = this.buildGlobMessage(resultFiles.length, totalFound, ignoredCount, truncated)

      return {
        files: resultFiles,
        ignoredCount,
        message,
        totalFound,
        truncated,
      }
    } catch (error) {
      // Check for pattern errors
      if (getErrorMessage(error).includes('Invalid glob pattern')) {
        throw new InvalidPatternError(pattern, getErrorMessage(error))
      }

      throw new GlobOperationError(pattern, getErrorMessage(error))
    }
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
   * List files and directories in a path.
   */
  public async listDirectory(dirPath: string, options: ListDirectoryOptions = {}): Promise<ListDirectoryResult> {
    this.ensureInitialized()

    // Resolve path
    const resolvedPath = path.resolve(this.config.workingDirectory, dirPath || '.')

    // Validate path
    const validation = this.pathValidator.validate(resolvedPath, 'read')
    if (!validation.valid) {
      this.throwValidationError(resolvedPath, validation.error)
    }

    const { normalizedPath } = validation

    // Verify directory exists
    try {
      const stats = await fs.stat(normalizedPath)
      if (!stats.isDirectory()) {
        throw new DirectoryNotFoundError(normalizedPath)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new DirectoryNotFoundError(normalizedPath)
      }

      throw error
    }

    const maxResults = options.maxResults ?? LIST_DIRECTORY_LIMIT
    const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...(options.ignore ?? [])]

    // Use glob with ** pattern to get all files
    const files = await glob('**/*', {
      absolute: false,
      cwd: normalizedPath,
      follow: false,
      ignore: ignorePatterns.map((p) => `**/${p}**`),
      nodir: true,
    })

    // Limit results
    const truncated = files.length > maxResults
    const limitedFiles = files.slice(0, maxResults)

    // Build directory structure
    const dirs = new Set<string>()
    const filesByDir = new Map<string, string[]>()

    for (const file of limitedFiles) {
      const dir = path.dirname(file)
      const parts = dir === '.' ? [] : dir.split('/')

      // Add all parent directories
      for (let i = 0; i <= parts.length; i++) {
        const currentDirPath = i === 0 ? '.' : parts.slice(0, i).join('/')
        dirs.add(currentDirPath)
      }

      // Add file to its directory
      if (!filesByDir.has(dir)) {
        filesByDir.set(dir, [])
      }

      filesByDir.get(dir)!.push(path.basename(file))
    }

    // Build entries array
    const entries: DirectoryEntry[] = limitedFiles.map((file) => ({
      isDirectory: false,
      name: path.basename(file),
      path: file,
    }))

    // Render tree
    const tree = this.renderDirectoryTree(normalizedPath, dirs, filesByDir)

    return {
      count: limitedFiles.length,
      entries,
      tree,
      truncated,
    }
  }

  /**
   * Read the contents of a file.
   *
   * Features:
   * - Relative path support (resolved against working directory)
   * - Image/PDF files returned as base64 attachments
   * - Binary file detection and rejection
   * - .env file blocking with whitelist for example files
   * - XML-wrapped output for clearer LLM parsing
   * - Preview metadata (first 20 lines)
   */
  // eslint-disable-next-line complexity -- Multiple file type handling paths (image/PDF, binary, text) are inherent to the functionality
  public async readFile(filePath: string, options: ReadFileOptions = {}): Promise<FileContent> {
    this.ensureInitialized()

    // Resolve relative paths against working directory
    let resolvedPath = filePath
    if (!path.isAbsolute(filePath)) {
      resolvedPath = path.resolve(this.config.workingDirectory, filePath)
    }

    // Validate path
    const validation = this.pathValidator.validate(resolvedPath, 'read')
    if (!validation.valid) {
      this.throwValidationError(resolvedPath, validation.error)
    }

    const { normalizedPath } = validation

    // Check .env file whitelist (allow .env.sample, .env.example, etc.)
    const fileName = path.basename(normalizedPath).toLowerCase()
    const isEnvFile = fileName.includes('.env')
    const isWhitelisted = ENV_WHITELIST.some((w) => fileName.endsWith(w))
    if (isEnvFile && !isWhitelisted) {
      throw new PathBlockedError(
        normalizedPath,
        'Environment files are blocked for security. Only example files (.env.sample, .env.example) are allowed.',
      )
    }

    try {
      // Check if file exists
      let stats
      try {
        stats = await fs.stat(normalizedPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Try to find similar files for suggestions
          const dirPath = path.dirname(normalizedPath)
          const baseName = path.basename(normalizedPath)
          const suggestions = await findSimilarFiles(dirPath, baseName)

          if (suggestions.length > 0) {
            throw new FileNotFoundError(
              normalizedPath,
              `File not found: ${normalizedPath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`,
            )
          }

          throw new FileNotFoundError(normalizedPath)
        }

        throw error
      }

      // Check file size
      if (stats.size > this.config.maxFileSize) {
        throw new FileTooLargeError(normalizedPath, stats.size, this.config.maxFileSize)
      }

      // Handle image/PDF files - return as base64 attachment
      if (isMediaFile(normalizedPath)) {
        const buffer = await fs.readFile(normalizedPath)
        const mimeType = getMimeType(normalizedPath) ?? 'application/octet-stream'
        const fileType = isPdfFile(normalizedPath) ? 'PDF' : 'Image'
        const baseName = path.basename(normalizedPath)

        return {
          attachment: {
            base64: buffer.toString('base64'),
            fileName: baseName,
            mimeType,
          },
          content: `[${fileType} file: ${baseName}]`,
          encoding: 'base64',
          formattedContent: `<file>\n[${fileType} file: ${baseName} (${stats.size} bytes)]\n</file>`,
          lines: 1,
          message: `${fileType} file read successfully. Content available as base64 attachment.`,
          size: stats.size,
          totalLines: 1,
          truncated: false,
        }
      }

      // Check for binary files (read first 4KB for detection)
      const handle = await fs.open(normalizedPath, 'r')
      const sampleBuffer = Buffer.alloc(BINARY_DETECTION_BUFFER_SIZE)
      const { bytesRead } = await handle.read(sampleBuffer, 0, BINARY_DETECTION_BUFFER_SIZE, 0)
      await handle.close()

      if (isBinaryFile(normalizedPath, sampleBuffer.subarray(0, bytesRead))) {
        throw new ReadOperationError(
          normalizedPath,
          'Cannot read binary file. Use a hex editor or appropriate tool for binary files.',
        )
      }

      // Read text file
      const encoding = (options.encoding ?? 'utf8') as BufferEncoding
      const rawContent = await fs.readFile(normalizedPath, encoding)

      // Split into lines
      const allLines = rawContent.split('\n')
      const totalLines = allLines.length

      // Apply offset and limit (with default limit of 2000)
      const offset = options.offset !== undefined && options.offset > 0 ? options.offset - 1 : 0
      const limit = options.limit ?? DEFAULT_READ_LIMIT
      const endLine = Math.min(offset + limit, totalLines)

      const selectedLines = allLines.slice(offset, endLine)
      const truncated = endLine < totalLines

      // Truncate long lines
      const truncatedLines = selectedLines.map((line) => truncateLine(line))

      // Format with line numbers
      const numberedContent = formatWithLineNumbers(truncatedLines, offset + 1)

      // Build informative message
      const lastReadLine = offset + selectedLines.length
      let message: string
      if (truncated) {
        const remainingLines = totalLines - lastReadLine
        message =
          `Read lines ${offset + 1}-${lastReadLine} of ${totalLines} total lines. ` +
          `${remainingLines} more lines available. Use offset=${lastReadLine + 1} to continue reading.`
      } else {
        message = `End of file - read ${selectedLines.length} lines (${totalLines} total).`
      }

      // Generate preview (first N lines of selected content)
      const previewLines = truncatedLines.slice(0, PREVIEW_LINES)
      const preview = previewLines.join('\n')

      // Wrap in XML tags for clearer LLM parsing
      const truncationNote = truncated
        ? `\n\n(File has more lines. Use offset=${lastReadLine + 1} to continue)`
        : `\n\n(End of file - ${totalLines} lines)`

      const formattedContent = `<file>\n${numberedContent}${truncationNote}\n</file>`

      return {
        content: truncatedLines.join('\n'),
        encoding,
        formattedContent,
        lines: selectedLines.length,
        message,
        preview,
        size: stats.size,
        totalLines,
        truncated,
        truncatedLineCount: truncatedLines.length,
      }
    } catch (error) {
      // Re-throw known errors
      if (
        error instanceof FileNotFoundError ||
        error instanceof FileTooLargeError ||
        error instanceof PathNotAllowedError ||
        error instanceof PathTraversalError ||
        error instanceof PathBlockedError ||
        error instanceof ReadOperationError
      ) {
        throw error
      }

      // Wrap other errors
      throw new ReadOperationError(normalizedPath, getErrorMessage(error))
    }
  }

  /**
   * Search file contents for a pattern.
   * Uses native grep commands (ripgrep, system grep) when available for better performance,
   * falling back to JavaScript implementation when needed.
   */
  public async searchContent(pattern: string, options: SearchOptions = {}): Promise<SearchResult> {
    this.ensureInitialized()

    const cwd = options.cwd ?? this.config.workingDirectory
    const maxResults = options.maxResults ?? 100
    const contextLines = options.contextLines ?? 0

    // If context lines requested, use JS fallback directly (native grep context parsing is complex)
    if (contextLines > 0) {
      return this.searchContentJS(pattern, options)
    }

    try {
      // Try native strategies in order: ripgrep → system grep → JS fallback
      let matches: null | SearchMatch[] = null

      matches = await this.executeRipgrep(pattern, cwd, options)
      if (matches === null) {
        matches = await this.executeSystemGrep(pattern, cwd, options)
      }

      if (matches === null) {
        return this.searchContentJS(pattern, options)
      }

      // Collect file modification times for sorting (recent files first)
      const matchesWithMtime = await Promise.all(
        matches.map(async (match) => {
          try {
            const stats = await fs.stat(match.file)
            return { ...match, mtime: stats.mtime.getTime() }
          } catch {
            return { ...match, mtime: 0 }
          }
        }),
      )

      // Sort by modification time (newest first)
      matchesWithMtime.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))

      // Apply maxResults limit
      const truncated = matchesWithMtime.length > maxResults

      return {
        filesSearched: new Set(matchesWithMtime.map((m) => m.file)).size,
        matches: matchesWithMtime.slice(0, maxResults),
        totalMatches: matchesWithMtime.length,
        truncated,
      }
    } catch (error) {
      // Re-throw known errors
      if (error instanceof InvalidPatternError || error instanceof GlobOperationError) {
        throw error
      }

      throw new SearchOperationError(pattern, getErrorMessage(error))
    }
  }

  /**
   * Write content to a file.
   */
  public async writeFile(filePath: string, content: string, options: WriteFileOptions = {}): Promise<WriteResult> {
    this.ensureInitialized()

    // Validate path
    const validation = this.pathValidator.validate(filePath, 'write')
    if (!validation.valid) {
      this.throwValidationError(filePath, validation.error)
    }

    const { normalizedPath } = validation

    try {
      // Create parent directories if requested
      if (options.createDirs) {
        const dirname = path.dirname(normalizedPath)
        await fs.mkdir(dirname, { recursive: true })
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
      throw new WriteOperationError(normalizedPath, getErrorMessage(error))
    }
  }

  /**
   * Builds a human-readable message for glob results.
   */
  private buildGlobMessage(returned: number, total: number, ignored: number, truncated: boolean): string {
    const parts: string[] = []

    if (truncated) {
      parts.push(`Found ${total} files, showing first ${returned}`)
    } else {
      parts.push(`Found ${returned} file${returned === 1 ? '' : 's'}`)
    }

    if (ignored > 0) {
      parts.push(`(${ignored} ignored by .gitignore)`)
    }

    return parts.join(' ')
  }

  /**
   * Collects context lines before and after a match.
   */
  private collectContextLines(
    lines: string[],
    lineIndex: number,
    contextLines: number,
  ): { after: string[]; before: string[] } {
    const before: string[] = []
    const after: string[] = []

    if (contextLines > 0) {
      // Lines before
      for (let j = Math.max(0, lineIndex - contextLines); j < lineIndex; j++) {
        before.push(truncateLine(lines[j]))
      }

      // Lines after
      for (let j = lineIndex + 1; j < Math.min(lines.length, lineIndex + 1 + contextLines); j++) {
        after.push(truncateLine(lines[j]))
      }
    }

    return { after, before }
  }

  /**
   * Creates a regex from a pattern string.
   */
  private createSearchRegex(pattern: string, caseInsensitive: boolean): RegExp {
    const flags = caseInsensitive ? 'i' : ''
    try {
      return new RegExp(pattern, flags)
    } catch (error) {
      throw new InvalidPatternError(pattern, getErrorMessage(error))
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
   * Executes ripgrep (rg) for content search.
   * Returns null if rg is not available or fails.
   */
  private async executeRipgrep(pattern: string, cwd: string, options: SearchOptions): Promise<null | SearchMatch[]> {
    if (!(await this.isCommandAvailable('rg'))) return null

    const args = ['-n', '--no-heading', '--with-filename']
    if (options.caseInsensitive) args.push('-i')

    // Add exclusions for blocked paths
    for (const blocked of this.config.blockedPaths) {
      args.push('--glob', `!${blocked}`)
    }

    if (options.globPattern) args.push('--glob', options.globPattern)
    args.push(pattern, '.') // Add search path to prevent reading from stdin

    try {
      const output = await this.spawnCommand('rg', args, cwd, options.abortSignal)
      return this.parseGrepOutput(output, cwd)
    } catch {
      return null
    }
  }

  /**
   * Executes system grep for content search.
   * Returns null if grep is not available or fails.
   */
  private async executeSystemGrep(pattern: string, cwd: string, options: SearchOptions): Promise<null | SearchMatch[]> {
    if (!(await this.isCommandAvailable('grep'))) return null

    const args = ['-r', '-n', '-H', '-E', '-I']
    if (options.caseInsensitive) args.push('-i')

    // Add exclusions for blocked paths
    for (const blocked of this.config.blockedPaths) {
      args.push(`--exclude-dir=${blocked}`)
    }

    if (options.globPattern) args.push(`--include=${options.globPattern}`)
    args.push(pattern, '.')

    try {
      const output = await this.spawnCommand('grep', args, cwd, options.abortSignal)
      return this.parseGrepOutput(output, cwd)
    } catch {
      return null
    }
  }

  /**
   * Checks if a command is available in the system's PATH.
   */
  private isCommandAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkCmd = process.platform === 'win32' ? 'where' : 'command'
      const checkArgs = process.platform === 'win32' ? [command] : ['-v', command]
      try {
        const child = spawn(checkCmd, checkArgs, { shell: true, stdio: 'ignore' })
        child.on('close', (code) => resolve(code === 0))
        child.on('error', () => resolve(false))
      } catch {
        resolve(false)
      }
    })
  }

  /**
   * Parses output from grep-like commands (filepath:lineNumber:content format).
   */
  private parseGrepOutput(output: string, basePath: string): SearchMatch[] {
    const results: SearchMatch[] = []
    if (!output) return results

    for (const line of output.split(EOL)) {
      if (!line.trim()) continue

      // Format: filepath:lineNumber:content
      const firstColon = line.indexOf(':')
      if (firstColon === -1) continue

      const secondColon = line.indexOf(':', firstColon + 1)
      if (secondColon === -1) continue

      const filePath = line.slice(0, firstColon)
      const lineNumber = Number.parseInt(line.slice(firstColon + 1, secondColon), 10)
      const content = line.slice(secondColon + 1)

      if (!Number.isNaN(lineNumber)) {
        results.push({
          file: path.resolve(basePath, filePath),
          line: truncateLine(content),
          lineNumber,
        })
      }
    }

    return results
  }

  /**
   * Renders a directory tree as a string.
   */
  private renderDirectoryTree(basePath: string, dirs: Set<string>, filesByDir: Map<string, string[]>): string {
    const renderDir = (dirPath: string, depth: number): string => {
      const indent = '  '.repeat(depth)
      let output = ''

      if (depth > 0) {
        output += `${indent}${path.basename(dirPath)}/\n`
      }

      const childIndent = '  '.repeat(depth + 1)
      const children = [...dirs].filter((d) => path.dirname(d) === dirPath && d !== dirPath).sort()

      // Render subdirectories first
      for (const child of children) {
        output += renderDir(child, depth + 1)
      }

      // Render files
      const files = filesByDir.get(dirPath) ?? []
      for (const file of files.sort()) {
        output += `${childIndent}${file}\n`
      }

      return output
    }

    return `${basePath}/\n${renderDir('.', 0)}`
  }

  /**
   * JavaScript-based content search implementation.
   * Used as fallback when native grep commands are unavailable or when context lines are needed.
   */
  private async searchContentJS(pattern: string, options: SearchOptions = {}): Promise<SearchResult> {
    const globPattern = options.globPattern ?? '**/*'
    const cwd = options.cwd ?? this.config.workingDirectory
    const maxResults = options.maxResults ?? 100
    const contextLines = options.contextLines ?? 0
    const caseInsensitive = options.caseInsensitive ?? false

    try {
      // Create regex
      const regex = this.createSearchRegex(pattern, caseInsensitive)

      // Find files to search
      const globResult = await this.globFiles(globPattern, {
        cwd,
        includeMetadata: false,
        maxResults: 10_000, // Search more files, but limit results
      })

      return await this.searchFiles(globResult.files, regex, maxResults, contextLines)
    } catch (error) {
      // Re-throw known errors
      if (error instanceof InvalidPatternError || error instanceof GlobOperationError) {
        throw error
      }

      throw new SearchOperationError(pattern, getErrorMessage(error))
    }
  }

  /**
   * Searches a single file for a regex pattern.
   */
  private async searchFile(
    filePath: string,
    regex: RegExp,
    maxMatches: number,
    contextLines: number,
  ): Promise<{ matches: SearchMatch[]; totalMatches: number }> {
    const fileContent = await this.readFile(filePath)
    const lines = fileContent.content.split('\n')
    const matches: SearchMatch[] = []
    let totalMatches = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (regex.test(line)) {
        totalMatches++

        if (matches.length >= maxMatches) {
          break
        }

        const context = this.collectContextLines(lines, i, contextLines)
        matches.push({
          context: contextLines > 0 ? context : undefined,
          file: filePath,
          line: truncateLine(line),
          lineNumber: i + 1, // 1-based line numbers
        })
      }
    }

    return { matches, totalMatches }
  }

  /**
   * Searches multiple files for a regex pattern.
   */
  private async searchFiles(
    files: FileMetadata[],
    regex: RegExp,
    maxResults: number,
    contextLines: number,
  ): Promise<SearchResult> {
    const matches: SearchMatch[] = []
    let totalMatches = 0
    let filesSearched = 0

    for (const fileInfo of files) {
      filesSearched++

      try {
        // eslint-disable-next-line no-await-in-loop
        const fileMatches = await this.searchFile(fileInfo.path, regex, maxResults - matches.length, contextLines)
        totalMatches += fileMatches.totalMatches

        for (const match of fileMatches.matches) {
          matches.push(match)

          if (matches.length >= maxResults) {
            return {
              filesSearched,
              matches,
              totalMatches,
              truncated: true,
            }
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
  }

  /**
   * Spawns a command and returns its stdout.
   */
  private spawnCommand(cmd: string, args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, windowsHide: true })
      const chunks: Buffer[] = []

      if (signal) {
        signal.addEventListener('abort', () => child.kill(), { once: true })
      }

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0 || code === 1) {
          // 1 = no matches found (not an error)
          resolve(Buffer.concat(chunks).toString('utf8'))
        } else {
          reject(new Error(`Command exited with code ${code}`))
        }
      })
    })
  }

  /**
   * Throws the appropriate error based on validation error message.
   */
  private throwValidationError(filePath: string, error: string): never {
    if (error.includes('empty')) {
      throw new InvalidPathError(filePath, error)
    }

    if (error.includes('traversal')) {
      throw new PathTraversalError(filePath)
    }

    if (error.includes('not in allowed paths')) {
      throw new PathNotAllowedError(filePath, this.config.allowedPaths)
    }

    if (error.includes('blocked')) {
      throw new PathBlockedError(filePath, error)
    }

    if (error.includes('extension')) {
      const ext = filePath.split('.').pop() ?? ''
      throw new InvalidExtensionError(filePath, ext)
    }

    // Fallback
    throw new InvalidPathError(filePath, error)
  }
}
