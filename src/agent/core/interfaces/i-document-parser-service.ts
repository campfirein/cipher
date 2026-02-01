/**
 * Supported document types for parsing.
 */
export type DocumentType = 'docx' | 'odp' | 'ods' | 'odt' | 'pdf' | 'pptx' | 'xlsx'

/**
 * Result of parsing a document.
 */
export interface DocumentParseResult {
  /** Extracted text content from the document */
  content: string

  /** Optional metadata extracted from the document */
  metadata?: {
    /** Document author (if available) */
    author?: string

    /** Document creation date (if available) */
    createdAt?: Date

    /** Number of pages/slides (if applicable) */
    pageCount?: number

    /** Document title (if available) */
    title?: string
  }

  /** The type of document that was parsed */
  type: DocumentType
}

/**
 * Options for document parsing.
 */
export interface DocumentParseOptions {
  /** Maximum content length to extract (characters). Default: unlimited */
  maxLength?: number
}

/**
 * Interface for document parsing service.
 * Handles extraction of text content from various document formats.
 */
export interface IDocumentParserService {
  /**
   * Parse a document and extract its text content.
   *
   * @param filePath - Path to the document file
   * @param buffer - Buffer containing the document data
   * @param options - Optional parsing options
   * @returns Parsed document result with content and metadata
   * @throws Error if document type is unsupported or parsing fails
   */
  parse(filePath: string, buffer: Buffer, options?: DocumentParseOptions): Promise<DocumentParseResult>

  /**
   * Check if a file extension is supported for parsing.
   *
   * @param ext - File extension (with or without leading dot)
   * @returns true if the extension is supported
   */
  supportsExtension(ext: string): boolean
}
