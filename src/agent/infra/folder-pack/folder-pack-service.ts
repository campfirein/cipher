import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  FolderPackConfig,
  FolderPackResult,
  PackedFile,
  PackProgressCallback,
  SkippedFile,
  SkipReason,
} from '../../core/domain/folder-pack/types.js'
import type {IDocumentParserService} from '../../core/interfaces/i-document-parser-service.js'
import type {IFileSystem} from '../../core/interfaces/i-file-system.js'
import type {IFolderPackService} from '../../core/interfaces/i-folder-pack-service.js'

import {DirectoryNotFoundError} from '../../core/domain/errors/file-system-error.js'
import {isOfficeFile} from '../file-system/binary-utils.js'
import {getDefaultIgnorePatterns} from './default-ignore.js'
import {generatePackedXml} from './output-generator.js'

/**
 * Default configuration for folder packing.
 */
const DEFAULT_CONFIG: FolderPackConfig = {
  extractDocuments: false,
  extractPdfText: true,
  ignore: [],
  include: ['**/*'],
  includeTree: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxLinesPerFile: 10_000,
  useGitignore: true,
}

/**
 * Common code file extensions for type detection.
 */
const CODE_EXTENSIONS = new Set([
  '.asm', '.bash', '.c', '.cc', '.cjs', '.clj',
  '.cljc', '.cljs',
  '.cpp', '.cs', '.cxx', '.elm',
  '.erl',
  '.ex',
  '.exs', '.fish',
  '.go',
  '.h', '.hpp', '.hrl', '.hs', '.java', '.js',
  '.jsx',
  '.kt',
  '.kts', '.lhs',
  '.lua', '.m', '.mjs', '.ml',
  '.mli', '.mm',
  '.php',
  '.pl', '.pm',
  '.ps1', '.psm1',
  '.py', '.pyw',
  '.r', '.R', '.rake',
  '.rb', '.rs',
  '.s', '.scala',
  '.sh', '.sql',
  '.sv',
  '.svelte', '.swift',
  '.ts', '.tsx',
  '.v', '.vhd',
  '.vhdl',
  '.vue', '.zsh',
])

/**
 * Config/data file extensions.
 */
const CONFIG_EXTENSIONS = new Set([
  '.cfg', '.conf', '.env.example', '.env.sample', '.env.template', '.ini', '.json',
  '.plist', '.toml',
  '.xml', '.yaml', '.yml',
])

/**
 * Documentation file extensions.
 */
const DOC_EXTENSIONS = new Set([
  '.adoc', '.asciidoc', '.markdown',
  '.md', '.mdx',
  '.org', '.rst', '.text',
  '.txt',
])

/**
 * Service for packing folders into structured formats.
 * Uses FileSystemService for all file operations to ensure
 * consistent security policies and error handling.
 */
export class FolderPackService implements IFolderPackService {
  private readonly documentParser?: IDocumentParserService
  private readonly fileSystemService: IFileSystem
  private initialized = false

  /**
   * Creates a new FolderPackService.
   * @param fileSystemService - The file system service to use for file operations
   * @param documentParser - Optional document parser for Office files (docx, xlsx, pptx)
   */
  constructor(fileSystemService: IFileSystem, documentParser?: IDocumentParserService) {
    this.fileSystemService = fileSystemService
    this.documentParser = documentParser
  }

  /**
   * Generate XML output from a pack result.
   */
  generateXml(result: FolderPackResult): string {
    return generatePackedXml(result)
  }

  /**
   * Initialize the service.
   * Must be called before any pack operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.fileSystemService.initialize()
    this.initialized = true
  }

  /**
   * Pack a folder into a structured result.
   */
  async pack(
    folderPath: string,
    config?: Partial<FolderPackConfig>,
    onProgress?: PackProgressCallback,
  ): Promise<FolderPackResult> {
    this.ensureInitialized()

    const startTime = Date.now()
    const mergedConfig = this.mergeConfig(config)

    // Resolve to absolute path
    const rawAbsolutePath = path.isAbsolute(folderPath)
      ? folderPath
      : path.resolve(process.cwd(), folderPath)
    const absolutePath = await fs.realpath(rawAbsolutePath).catch(() => rawAbsolutePath)

    // Phase 1: Search for files
    onProgress?.({current: 0, message: 'Searching for files...', phase: 'searching'})

    const ignorePatterns = [...getDefaultIgnorePatterns(), ...mergedConfig.ignore]

    let globResult
    try {
      globResult = await this.fileSystemService.globFiles('**/*', {
        cwd: absolutePath,
        includeMetadata: true,
        maxResults: 10_000, // Reasonable limit
        respectGitignore: mergedConfig.useGitignore,
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new DirectoryNotFoundError(absolutePath)
      }

      throw error
    }

    const discoveredFiles = globResult.files
      .map((file) => {
        const absoluteFilePath = path.isAbsolute(file.path) ? file.path : path.resolve(absolutePath, file.path)

        return {
          absolutePath: absoluteFilePath,
          relativePath: this.toRelativePackPath(absolutePath, absoluteFilePath),
          size: file.size,
        }
      })
      .filter((file) => file.relativePath.length > 0 && !file.relativePath.startsWith('../'))

    // Filter files based on ignore patterns using paths relative to the packed root.
    const filteredFiles = discoveredFiles.filter((file) => !this.matchesIgnorePattern(file.relativePath, ignorePatterns))

    onProgress?.({
      current: filteredFiles.length,
      message: `Found ${filteredFiles.length} files`,
      phase: 'searching',
    })

    // Phase 2: Collect file contents in parallel
    const files: PackedFile[] = []
    const skippedFiles: SkippedFile[] = []
    const totalFiles = filteredFiles.length

    onProgress?.({
      current: 0,
      message: 'Reading files...',
      phase: 'collecting',
      total: totalFiles,
    })

    // Use Promise.all for parallel file reading (following batch-tool pattern)
    const readResults = await Promise.all(
      filteredFiles.map(async (fileInfo, index) => {
        // Report progress (note: may be out of order due to parallelism)
        onProgress?.({
          current: index + 1,
          message: `Reading ${fileInfo.relativePath}`,
          phase: 'collecting',
          total: totalFiles,
        })

        try {
          // Check file size before reading
          if (fileInfo.size > mergedConfig.maxFileSize) {
            return {
              skipped: {
                message: `File size ${fileInfo.size} exceeds limit ${mergedConfig.maxFileSize}`,
                path: fileInfo.relativePath,
                reason: 'size-limit' as SkipReason,
              },
              type: 'skipped' as const,
            }
          }

          // Check if this is an Office document that should be parsed
          if (mergedConfig.extractDocuments && this.documentParser && isOfficeFile(fileInfo.absolutePath)) {
            return this.parseOfficeDocument(fileInfo.absolutePath, fileInfo.relativePath, fileInfo.size)
          }

          // Read file content using FileSystemService
          // This handles binary detection, PDF extraction, encoding, etc.
          const fileContent = await this.fileSystemService.readFile(fileInfo.absolutePath, {
            limit: mergedConfig.maxLinesPerFile,
          })

          // Check if it's a PDF with extracted text
          const isPdf = fileContent.pdfPages && fileContent.pdfPages.length > 0

          return {
            file: {
              content: fileContent.content,
              fileType: isPdf ? 'pdf' : this.detectFileType(fileInfo.relativePath),
              lineCount: fileContent.lines,
              path: fileInfo.relativePath,
              size: fileInfo.size,
              truncated: fileContent.truncated,
            },
            type: 'success' as const,
          }
        } catch (error) {
          // Categorize the error and skip the file
          const skipReason = this.categorizeError(error)
          return {
            skipped: {
              message: error instanceof Error ? error.message : String(error),
              path: fileInfo.relativePath,
              reason: skipReason,
            },
            type: 'skipped' as const,
          }
        }
      }),
    )

    // Separate successes and failures
    for (const result of readResults) {
      if (result.type === 'success') {
        files.push(result.file)
      } else {
        skippedFiles.push(result.skipped)
      }
    }

    // Phase 3: Generate directory tree
    let directoryTree = ''
    if (mergedConfig.includeTree) {
      onProgress?.({current: 0, message: 'Generating directory tree...', phase: 'generating'})

      try {
        const treeResult = await this.fileSystemService.listDirectory(absolutePath, {
          ignore: ignorePatterns,
          maxResults: 500,
        })
        directoryTree = treeResult.tree
      } catch {
        // Tree generation is optional, don't fail the whole operation
        directoryTree = '(Unable to generate directory tree)'
      }
    }

    onProgress?.({current: 1, message: 'Pack complete', phase: 'generating'})

    return {
      config: mergedConfig,
      directoryTree,
      durationMs: Date.now() - startTime,
      fileCount: files.length,
      files,
      rootPath: absolutePath,
      skippedCount: skippedFiles.length,
      skippedFiles,
      totalCharacters: files.reduce((sum, f) => sum + f.content.length, 0),
      totalLines: files.reduce((sum, f) => sum + f.lineCount, 0),
    }
  }

  /**
   * Categorize an error into a skip reason.
   */
  private categorizeError(error: unknown): SkipReason {
    if (!(error instanceof Error)) {
      return 'read-error'
    }

    const message = error.message.toLowerCase()

    if (message.includes('binary')) {
      return 'binary'
    }

    if (message.includes('too large') || message.includes('size')) {
      return 'size-limit'
    }

    if (message.includes('permission') || message.includes('access')) {
      return 'permission'
    }

    if (message.includes('encoding') || message.includes('decode')) {
      return 'encoding'
    }

    return 'read-error'
  }

  /**
   * Detect file type based on extension.
   */
  private detectFileType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()

    if (CODE_EXTENSIONS.has(ext)) {
      return 'code'
    }

    if (CONFIG_EXTENSIONS.has(ext)) {
      return 'config'
    }

    if (DOC_EXTENSIONS.has(ext)) {
      return 'doc'
    }

    return 'text'
  }

  /**
   * Ensure the service is initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FolderPackService not initialized. Call initialize() first.')
    }
  }

  /**
   * Check if a path matches any ignore pattern.
   */
  private matchesIgnorePattern(filePath: string, patterns: string[]): boolean {
    const normalizedPath = filePath.replaceAll('\\', '/')

    for (const pattern of patterns) {
      // Simple glob matching (supports ** and *)
      const regexPattern = pattern
        .replaceAll('.', String.raw`\.`)
        .replaceAll('**', '<<<DOUBLESTAR>>>')
        .replaceAll('*', '[^/]*')
        .replaceAll('<<<DOUBLESTAR>>>', '.*')

      const regex = new RegExp(`^${regexPattern}$|/${regexPattern}$|^${regexPattern}/|/${regexPattern}/`)

      if (regex.test(normalizedPath)) {
        return true
      }
    }

    return false
  }

  /**
   * Merge user config with defaults.
   */
  private mergeConfig(config?: Partial<FolderPackConfig>): FolderPackConfig {
    if (!config) {
      return {...DEFAULT_CONFIG}
    }

    return {
      extractDocuments: config.extractDocuments ?? DEFAULT_CONFIG.extractDocuments,
      extractPdfText: config.extractPdfText ?? DEFAULT_CONFIG.extractPdfText,
      ignore: config.ignore ?? DEFAULT_CONFIG.ignore,
      include: config.include ?? DEFAULT_CONFIG.include,
      includeTree: config.includeTree ?? DEFAULT_CONFIG.includeTree,
      maxFileSize: config.maxFileSize ?? DEFAULT_CONFIG.maxFileSize,
      maxLinesPerFile: config.maxLinesPerFile ?? DEFAULT_CONFIG.maxLinesPerFile,
      useGitignore: config.useGitignore ?? DEFAULT_CONFIG.useGitignore,
    }
  }

  /**
   * Parse an Office document using the document parser.
   */
  private async parseOfficeDocument(
    filePath: string,
    outputPath: string,
    size: number,
  ): Promise<{file: PackedFile; type: 'success'} | {skipped: SkippedFile; type: 'skipped'}> {
    if (!this.documentParser) {
      return {
        skipped: {
          message: 'Document parser not available',
          path: outputPath,
          reason: 'read-error' as SkipReason,
        },
        type: 'skipped',
      }
    }

    try {
      // Read the file as a buffer
      const buffer = await fs.readFile(filePath)

      // Parse the document
      const result = await this.documentParser.parse(filePath, buffer)

      const lines = result.content.split('\n')

      return {
        file: {
          content: result.content,
          fileType: 'document',
          lineCount: lines.length,
          path: outputPath,
          size,
          truncated: false,
        },
        type: 'success',
      }
    } catch (error) {
      return {
        skipped: {
          message: error instanceof Error ? error.message : String(error),
          path: outputPath,
          reason: 'read-error' as SkipReason,
        },
        type: 'skipped',
      }
    }
  }

  private toRelativePackPath(rootPath: string, filePath: string): string {
    return path.relative(rootPath, filePath).replaceAll('\\', '/')
  }
}
