import { extractText, getDocumentProxy, getMeta } from 'unpdf'

import type { PdfMetadata, PdfPageContent } from '../../../core/domain/cipher/file-system/types.js'

import { PdfExtractionError } from '../../../core/domain/cipher/errors/file-system-error.js'

/**
 * PDF magic bytes: %PDF-
 */
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]

/**
 * Default number of pages to extract when no limit specified.
 */
const DEFAULT_PAGE_LIMIT = 50

/**
 * Maximum number of pages allowed per extraction.
 */
const MAX_PAGE_LIMIT = 200

/**
 * Options for PDF text extraction.
 */
export interface PdfExtractOptions {
  /** Maximum number of pages to extract (default: 50, max: 200) */
  limit?: number

  /** Starting page number (1-based, default: 1) */
  offset?: number
}

/**
 * Result of PDF text extraction.
 */
export interface PdfExtractResult {
  /** Whether there are more pages available after this extraction */
  hasMore: boolean

  /** PDF metadata (page count, title, author, etc.) */
  metadata: PdfMetadata

  /** Extracted page contents */
  pages: PdfPageContent[]
}

/**
 * PDF text extraction and metadata extraction utility.
 * Provides page-by-page extraction with pagination support.
 *
 * Features:
 * - Magic byte validation
 * - Fast metadata-only extraction
 * - Page-by-page text extraction with offset/limit
 * - Default: 50 pages, max: 200 pages per extraction
 */
export class PdfExtractor {
  /**
   * Extracts metadata from a PDF buffer without extracting text.
   * This is a fast path when you only need page count, title, author, etc.
   *
   * @param buffer - PDF file buffer
   * @param filePath - Path to the PDF file (for error messages)
   * @returns PDF metadata
   */
  public static async extractMetadata(buffer: Buffer, filePath: string): Promise<PdfMetadata> {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const meta = await getMeta(pdf)
      return PdfExtractor.buildMetadataFromInfo(pdf.numPages, meta.info as Record<string, unknown> | undefined)
    } catch (error) {
      throw PdfExtractor.wrapExtractionError(error, filePath)
    }
  }

  /**
   * Extracts text from a PDF buffer with pagination support.
   *
   * @param buffer - PDF file buffer
   * @param filePath - Path to the PDF file (for error messages)
   * @param options - Extraction options (offset, limit)
   * @returns Extraction result with pages, metadata, and continuation info
   */
  public static async extractText(
    buffer: Buffer,
    filePath: string,
    options: PdfExtractOptions = {},
  ): Promise<PdfExtractResult> {
    // Validate PDF magic bytes
    if (!PdfExtractor.isValidPdf(buffer)) {
      throw new PdfExtractionError(filePath, 'Invalid PDF file format (missing PDF header)')
    }

    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const meta = await getMeta(pdf)
      const totalPages = pdf.numPages
      const metaInfo = meta.info as Record<string, unknown> | undefined

      // Calculate pagination
      const offset = Math.max(1, options.offset ?? 1)
      const limit = Math.min(options.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)

      // Return empty result if offset is beyond total pages
      if (offset > totalPages) {
        return {
          hasMore: false,
          metadata: PdfExtractor.buildMetadataFromInfo(totalPages, metaInfo),
          pages: [],
        }
      }

      // Extract text from all pages (unpdf doesn't support page-by-page extraction directly)
      const textResult = await extractText(pdf, { mergePages: false })
      const allPageTexts = textResult.text

      // Calculate page range and extract pages
      const endPage = Math.min(offset + limit - 1, totalPages)
      const pages = PdfExtractor.extractPageRange(allPageTexts, offset, endPage)

      return {
        hasMore: endPage < totalPages,
        metadata: PdfExtractor.buildMetadataFromInfo(totalPages, metaInfo),
        pages,
      }
    } catch (error) {
      throw PdfExtractor.wrapExtractionError(error, filePath)
    }
  }

  /**
   * Checks if a buffer contains valid PDF magic bytes.
   * @param buffer - Buffer to check
   * @returns true if buffer starts with %PDF-
   */
  public static isValidPdf(buffer: Buffer): boolean {
    if (buffer.length < PDF_MAGIC_BYTES.length) {
      return false
    }

    for (const [index, byte] of PDF_MAGIC_BYTES.entries()) {
      if (buffer[index] !== byte) {
        return false
      }
    }

    return true
  }

  /**
   * Builds PdfMetadata from unpdf meta info object.
   * @param pageCount - Total number of pages
   * @param info - Optional info object from unpdf getMeta
   * @returns PdfMetadata object
   */
  private static buildMetadataFromInfo(pageCount: number, info?: Record<string, unknown>): PdfMetadata {
    const metadata: PdfMetadata = { pageCount }

    if (!info) {
      return metadata
    }

    if (typeof info.Title === 'string' && info.Title.trim()) {
      metadata.title = info.Title.trim()
    }

    if (typeof info.Author === 'string' && info.Author.trim()) {
      metadata.author = info.Author.trim()
    }

    if (info.CreationDate) {
      const parsed = PdfExtractor.parsePdfDate(info.CreationDate as string)
      if (parsed) {
        metadata.creationDate = parsed
      }
    }

    return metadata
  }

  /**
   * Extracts pages from the text array for the given range.
   * @param allPageTexts - Array of text content for all pages
   * @param startPage - Starting page number (1-based)
   * @param endPage - Ending page number (1-based, inclusive)
   * @returns Array of PdfPageContent
   */
  private static extractPageRange(allPageTexts: string[], startPage: number, endPage: number): PdfPageContent[] {
    const pages: PdfPageContent[] = []
    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      const text = allPageTexts[pageNum - 1] ?? ''
      pages.push({
        pageNumber: pageNum,
        text: text.trim(),
      })
    }

    return pages
  }

  /**
   * Extracts a meaningful error message from an unknown error.
   */
  private static getExtractionErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }

    if (typeof error === 'string') {
      return error
    }

    return 'Unknown PDF extraction error'
  }

  /**
   * Parses PDF date string format (D:YYYYMMDDHHmmSS) to Date object.
   * @param dateStr - PDF date string
   * @returns Parsed Date or undefined if invalid
   */
  private static parsePdfDate(dateStr: string): Date | undefined {
    if (!dateStr) {
      return undefined
    }

    // PDF date format: D:YYYYMMDDHHmmSS+HH'mm' or variations
    const match = dateStr.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/)
    if (!match) {
      return undefined
    }

    const year = Number.parseInt(match[1], 10)
    const month = match[2] ? Number.parseInt(match[2], 10) - 1 : 0
    const day = match[3] ? Number.parseInt(match[3], 10) : 1
    const hour = match[4] ? Number.parseInt(match[4], 10) : 0
    const minute = match[5] ? Number.parseInt(match[5], 10) : 0
    const second = match[6] ? Number.parseInt(match[6], 10) : 0

    return new Date(year, month, day, hour, minute, second)
  }

  /**
   * Wraps extraction errors with appropriate PdfExtractionError.
   * @param error - The caught error
   * @param filePath - Path to the PDF file
   * @returns PdfExtractionError with appropriate message
   */
  private static wrapExtractionError(error: unknown, filePath: string): PdfExtractionError {
    const errorMessage = PdfExtractor.getExtractionErrorMessage(error)
    const lowerMessage = errorMessage.toLowerCase()

    if (lowerMessage.includes('password') || lowerMessage.includes('encrypted')) {
      return new PdfExtractionError(filePath, 'PDF is password-protected or encrypted')
    }

    return new PdfExtractionError(filePath, errorMessage)
  }
}

/**
 * Formats extracted PDF pages into a readable string with page separators.
 * @param pages - Array of extracted page contents
 * @param metadata - PDF metadata
 * @param hasMore - Whether there are more pages
 * @param nextOffset - Next offset for continuation (if hasMore is true)
 * @returns Formatted string with page separators
 */
export function formatPdfContent(
  pages: PdfPageContent[],
  metadata: PdfMetadata,
  hasMore: boolean,
  nextOffset: number,
): string {
  if (pages.length === 0) {
    return ''
  }

  const formattedPages = pages.map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`).join('\n\n')

  const truncationNote = hasMore
    ? `\n\n(PDF has more pages. Use offset=${nextOffset} to continue)`
    : `\n\n(End of PDF - ${metadata.pageCount} pages)`

  return formattedPages + truncationNote
}
