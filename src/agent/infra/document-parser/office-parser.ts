import path from 'node:path'
import officeParser from 'officeparser'

import type {DocumentType} from '../../core/interfaces/i-document-parser-service.js'

/**
 * Supported Office file extensions.
 * Includes both Microsoft Office and OpenDocument formats.
 */
const OFFICE_EXTENSIONS = new Set([
  '.docx', // Microsoft Word
  '.odp', // OpenDocument Presentation
  '.ods', // OpenDocument Spreadsheet
  '.odt', // OpenDocument Text
  '.pptx', // Microsoft PowerPoint
  '.xlsx', // Microsoft Excel
])

/**
 * Result of office document extraction.
 */
export interface OfficeExtractionResult {
  /** Extracted text content */
  content: string

  /** Document metadata if available */
  metadata?: {
    author?: string
    createdAt?: Date
    title?: string
  }

  /** The document type */
  type: DocumentType
}

/**
 * Wrapper around the officeparser library for extracting text from Office documents.
 * Supports: docx, xlsx, pptx, odt, ods, odp
 */
export const OfficeParser = {
  /**
   * Extract text content from an Office document.
   *
   * @param buffer - Buffer containing the document data
   * @param filePath - Original file path (used for type detection)
   * @returns Extraction result with content and metadata
   * @throws Error if extraction fails
   */
  async extract(buffer: Buffer, filePath: string): Promise<OfficeExtractionResult> {
    const docType = this.getDocumentType(filePath)

    if (!docType) {
      throw new Error(`Unsupported office file type: ${path.extname(filePath)}`)
    }

    try {
      // officeparser v6+ returns an AST object
      const ast = await officeParser.parseOffice(buffer, {
        ignoreNotes: false,
        newlineDelimiter: '\n',
        outputErrorToConsole: false,
      })

      // Extract plain text from the AST
      const content = ast.toText()

      // Extract metadata if available
      const metadata: OfficeExtractionResult['metadata'] = {}

      if (ast.metadata) {
        if (ast.metadata.author) {
          metadata.author = ast.metadata.author
        }

        if (ast.metadata.title) {
          metadata.title = ast.metadata.title
        }

        if (ast.metadata.created) {
          metadata.createdAt = ast.metadata.created
        }
      }

      return {
        content,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        type: docType,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse office document: ${message}`)
    }
  },

  /**
   * Get the document type from a file path.
   *
   * @param filePath - Path to the file
   * @returns The document type or undefined if not supported
   */
  getDocumentType(filePath: string): DocumentType | undefined {
    const ext = path.extname(filePath).toLowerCase()

    switch (ext) {
      case '.docx': {
        return 'docx'
      }

      case '.odp': {
        return 'odp'
      }

      case '.ods': {
        return 'ods'
      }

      case '.odt': {
        return 'odt'
      }

      case '.pptx': {
        return 'pptx'
      }

      case '.xlsx': {
        return 'xlsx'
      }

      default: {
        return undefined
      }
    }
  },

  /**
   * Check if a file is an Office document based on its extension.
   *
   * @param filePath - Path to the file
   * @returns true if the file is an Office document
   */
  isOfficeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return OFFICE_EXTENSIONS.has(ext)
  },
};
