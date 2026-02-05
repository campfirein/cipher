import fs from 'node:fs/promises'

import type { IDocumentParserService } from '../../agent/core/interfaces/i-document-parser-service.js'

import { createDocumentParserService } from '../../agent/infra/document-parser/index.js'
import { isBinaryFile, isImageFile, isOfficeFile, isPdfFile } from '../../agent/infra/file-system/binary-utils.js'
import { formatPdfContent, PdfExtractor } from '../../agent/infra/file-system/pdf-extractor.js'

/**
 * Result of reading a file's content.
 */
export interface FileReadResult {
  /** Extracted content from the file */
  content: string

  /** Error message if reading failed */
  error?: string

  /** Original file path */
  filePath: string

  /** Detected file type */
  fileType: 'binary' | 'image' | 'office' | 'pdf' | 'text'

  /** Additional metadata about the file */
  metadata?: {
    /** Number of lines (for text files) */
    lineCount?: number

    /** Number of pages (for PDFs) */
    pageCount?: number

    /** Whether content was truncated */
    truncated?: boolean
  }

  /** Whether the read was successful */
  success: boolean
}

/**
 * Configuration options for file reading.
 */
export interface FileContentReaderConfig {
  /** Maximum content length per file in characters (default: 40000) */
  maxContentLength?: number

  /** Maximum lines to read for text files (default: 2000) */
  maxLinesPerFile?: number

  /** Maximum pages to extract for PDFs (default: 50) */
  maxPdfPages?: number
}

const DEFAULT_MAX_CONTENT_LENGTH = 40_000
const DEFAULT_MAX_LINES_PER_FILE = 2000
const DEFAULT_MAX_PDF_PAGES = 50
const SAMPLE_BUFFER_SIZE = 4096

/**
 * Service for reading file contents with support for various file types.
 *
 * Supports:
 * - Text/code files: Read directly with truncation
 * - Office documents (.docx, .pptx, .xlsx, etc.): Parse using DocumentParserService
 * - PDFs: Extract text using PdfExtractor
 * - Images/Binaries: Skip with appropriate error message
 */
export class FileContentReader {
  private readonly documentParser: IDocumentParserService

  constructor(documentParser?: IDocumentParserService) {
    this.documentParser = documentParser ?? createDocumentParserService()
  }

  /**
   * Read content from a single file based on its type.
   *
   * @param filePath - Absolute path to the file
   * @param config - Optional configuration for reading
   * @returns FileReadResult with content or error
   */
  async readFile(filePath: string, config: FileContentReaderConfig = {}): Promise<FileReadResult> {
    const maxLength = config.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH
    const maxLines = config.maxLinesPerFile ?? DEFAULT_MAX_LINES_PER_FILE
    const maxPdfPages = config.maxPdfPages ?? DEFAULT_MAX_PDF_PAGES

    try {
      // Read initial buffer for type detection
      const buffer = await fs.readFile(filePath)
      const sampleBuffer = buffer.subarray(0, SAMPLE_BUFFER_SIZE)

      // Handle by file type (order matters - check specific types first)

      // 1. Images - skip with warning
      if (isImageFile(filePath)) {
        return {
          content: '',
          error: 'Image files are not supported for text extraction',
          filePath,
          fileType: 'image',
          success: false,
        }
      }

      // 2. PDFs - extract text
      if (isPdfFile(filePath, sampleBuffer)) {
        return this.readPdfFile(filePath, buffer, maxPdfPages, maxLength)
      }

      // 3. Office documents - parse with DocumentParserService
      if (isOfficeFile(filePath)) {
        return this.readOfficeFile(filePath, buffer, maxLength)
      }

      // 4. Other binary files - skip with warning
      if (isBinaryFile(filePath, sampleBuffer)) {
        return {
          content: '',
          error: 'Binary files are not supported for text extraction',
          filePath,
          fileType: 'binary',
          success: false,
        }
      }

      // 5. Text files - read directly
      return this.readTextFile(filePath, buffer, maxLines, maxLength)
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : String(error),
        filePath,
        fileType: 'text',
        success: false,
      }
    }
  }

  /**
   * Read content from multiple files in parallel.
   *
   * @param filePaths - Array of absolute file paths
   * @param config - Optional configuration for reading
   * @returns Array of FileReadResult for each file
   */
  async readFiles(filePaths: string[], config: FileContentReaderConfig = {}): Promise<FileReadResult[]> {
    return Promise.all(filePaths.map((filePath) => this.readFile(filePath, config)))
  }

  /**
   * Read an Office document using DocumentParserService.
   */
  private async readOfficeFile(filePath: string, buffer: Buffer, maxLength: number): Promise<FileReadResult> {
    try {
      const result = await this.documentParser.parse(filePath, buffer, { maxLength })

      return {
        content: result.content,
        filePath,
        fileType: 'office',
        metadata: {
          pageCount: result.metadata?.pageCount,
          truncated: result.content.endsWith('[Content truncated...]'),
        },
        success: true,
      }
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : String(error),
        filePath,
        fileType: 'office',
        success: false,
      }
    }
  }

  /**
   * Read a PDF file using PdfExtractor.
   */
  private async readPdfFile(
    filePath: string,
    buffer: Buffer,
    maxPages: number,
    maxLength: number,
  ): Promise<FileReadResult> {
    try {
      const result = await PdfExtractor.extractText(buffer, filePath, { limit: maxPages })
      const content = formatPdfContent(result.pages, result.metadata, result.hasMore, maxPages + 1)

      // Truncate if too long
      const truncatedByLength = content.length > maxLength
      const finalContent = truncatedByLength ? content.slice(0, maxLength) + '\n[Content truncated...]' : content

      return {
        content: finalContent,
        filePath,
        fileType: 'pdf',
        metadata: {
          pageCount: result.metadata.pageCount,
          truncated: result.hasMore || truncatedByLength,
        },
        success: true,
      }
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : String(error),
        filePath,
        fileType: 'pdf',
        success: false,
      }
    }
  }

  /**
   * Read a text file with line and length truncation.
   */
  private readTextFile(
    filePath: string,
    buffer: Buffer,
    maxLines: number,
    maxLength: number,
  ): FileReadResult {
    const rawContent = buffer.toString('utf8')
    const lines = rawContent.split('\n')
    const totalLines = lines.length

    // Truncate by lines if needed
    const truncatedByLines = totalLines > maxLines
    let content = truncatedByLines ? lines.slice(0, maxLines).join('\n') + '\n[...truncated]' : rawContent

    // Truncate by length if needed
    const truncatedByLength = content.length > maxLength
    if (truncatedByLength) {
      content = content.slice(0, maxLength) + '\n[Content truncated...]'
    }

    return {
      content,
      filePath,
      fileType: 'text',
      metadata: {
        lineCount: totalLines,
        truncated: truncatedByLines || truncatedByLength,
      },
      success: true,
    }
  }
}

/**
 * Factory function to create a FileContentReader instance.
 */
export function createFileContentReader(documentParser?: IDocumentParserService): FileContentReader {
  return new FileContentReader(documentParser)
}
