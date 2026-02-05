import path from 'node:path'

import type {
  DocumentParseOptions,
  DocumentParseResult,
  IDocumentParserService,
} from '../../core/interfaces/i-document-parser-service.js'

import {OfficeParser} from './office-parser.js'

/**
 * All supported document extensions.
 * Combines Office formats and PDF.
 */
const SUPPORTED_EXTENSIONS = new Set([
  // Microsoft Office
  '.docx',
  // OpenDocument
  '.odp',
  '.ods',
  '.odt',
  '.pptx',
  '.xlsx',
])

/**
 * Service for parsing various document formats and extracting text content.
 * Coordinates between specialized parsers (Office, PDF) based on file type.
 *
 * Note: PDF parsing is handled separately by the existing PdfExtractor
 * in the file-system module. This service focuses on Office documents.
 */
export class DocumentParserService implements IDocumentParserService {
  /**
   * Parse a document and extract its text content.
   *
   * @param filePath - Path to the document file
   * @param buffer - Buffer containing the document data
   * @param options - Optional parsing options
   * @returns Parsed document result with content and metadata
   * @throws Error if document type is unsupported or parsing fails
   */
  async parse(filePath: string, buffer: Buffer, options?: DocumentParseOptions): Promise<DocumentParseResult> {
    const ext = path.extname(filePath).toLowerCase()

    // Check if it's an Office document
    if (OfficeParser.isOfficeFile(filePath)) {
      const result = await OfficeParser.extract(buffer, filePath)

      // Apply max length limit if specified
      let {content} = result
      if (options?.maxLength && content.length > options.maxLength) {
        content = content.slice(0, options.maxLength) + '\n[Content truncated...]'
      }

      return {
        content,
        metadata: result.metadata,
        type: result.type,
      }
    }

    throw new Error(`Unsupported document type: ${ext}`)
  }

  /**
   * Check if a file extension is supported for parsing.
   *
   * @param ext - File extension (with or without leading dot)
   * @returns true if the extension is supported
   */
  supportsExtension(ext: string): boolean {
    const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    return SUPPORTED_EXTENSIONS.has(normalizedExt)
  }
}

/**
 * Factory function to create a DocumentParserService instance.
 */
export function createDocumentParserService(): IDocumentParserService {
  return new DocumentParserService()
}
