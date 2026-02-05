import path from 'node:path'

/**
 * Known binary file extensions for fast-path detection.
 * These files are always treated as binary without content inspection.
 * Sorted alphabetically as required by linter.
 */
const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.a',
  '.bin',
  '.bz2',
  '.class',
  '.com',
  '.dat',
  '.db',
  '.dll',
  '.doc',
  '.docx',
  '.dylib',
  '.exe',
  '.gz',
  '.jar',
  '.lib',
  '.o',
  '.obj',
  '.odp',
  '.ods',
  '.odt',
  '.ppt',
  '.pptx',
  '.pyc',
  '.pyo',
  '.rar',
  '.so',
  '.sqlite',
  '.sqlite3',
  '.tar',
  '.war',
  '.wasm',
  '.xls',
  '.xlsx',
  '.xz',
  '.zip',
])

/**
 * Image file extensions that should be handled specially (base64 encoding).
 * Sorted alphabetically as required by linter.
 */
const IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'])

/**
 * Office document extensions that can be parsed for text extraction.
 * Sorted alphabetically as required by linter.
 */
const OFFICE_EXTENSIONS = new Set([
  '.docx',
  '.odp',
  '.ods',
  '.odt',
  '.pptx',
  '.xlsx',
])

/**
 * PDF extension for special handling.
 */
const PDF_EXTENSION = '.pdf'

/**
 * PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46 0x2D)
 */
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])

/**
 * Maximum offset to search for PDF magic bytes.
 * PDFs may have whitespace or comments before the header.
 */
const PDF_MAGIC_SEARCH_LIMIT = 1024

/**
 * SVG extension - treat as text, not image.
 */
const SVG_EXTENSION = '.svg'

/**
 * MIME type mappings for image and PDF files.
 */
const MIME_TYPES: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
}

/**
 * Threshold for control character ratio to consider a file binary.
 */
const CONTROL_CHAR_THRESHOLD = 0.1

/**
 * Unicode replacement character - indicates invalid UTF-8 sequence.
 */
const REPLACEMENT_CHAR = '\uFFFD'

/**
 * Checks if a file is binary based on extension and content analysis.
 *
 * Detection strategy:
 * 1. Fast path: Check against known binary extensions
 * 2. Check for null bytes (definitive binary indicator)
 * 3. UTF-8 aware: Check for invalid UTF-8 sequences (replacement character)
 * 4. Heuristic: Check for excessive control characters
 *
 * @param filePath - Path to the file (used for extension check)
 * @param buffer - Buffer containing first N bytes of the file
 * @returns true if the file is binary, false otherwise
 */
export function isBinaryFile(filePath: string, buffer: Buffer): boolean {
  const ext = path.extname(filePath).toLowerCase()

  // Fast path: known binary extensions
  if (BINARY_EXTENSIONS.has(ext)) {
    return true
  }

  // Images and PDFs are binary but handled specially
  if (isImageFile(filePath) || isPdfFile(filePath)) {
    return true
  }

  // Empty files are not binary
  if (buffer.length === 0) {
    return false
  }

  // Null byte is a definitive binary indicator
  if (buffer.includes(0)) {
    return true
  }

  // UTF-8 aware detection: invalid UTF-8 sequences produce replacement character
  const str = buffer.toString('utf8')
  if (str.includes(REPLACEMENT_CHAR)) {
    return true
  }

  // Count control characters (0x01-0x08, 0x0E-0x1F) - null bytes already handled above
  let controlCharCount = 0
  for (const byte of buffer) {
    if ((byte > 0 && byte < 9) || (byte > 13 && byte < 32)) {
      controlCharCount++
    }
  }

  return controlCharCount / buffer.length > CONTROL_CHAR_THRESHOLD
}

/**
 * Checks if a file is an image based on its extension.
 * SVG files are excluded as they are text-based.
 *
 * @param filePath - Path to the file
 * @returns true if the file is an image (excluding SVG)
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()

  // SVG is text-based, not a binary image
  if (ext === SVG_EXTENSION) {
    return false
  }

  return IMAGE_EXTENSIONS.has(ext)
}

/**
 * Checks if a file is a PDF. When buffer is provided, validates magic bytes (%PDF-).
 * Searches within first 1KB to handle PDFs with leading whitespace/comments.
 */
export function isPdfFile(filePath: string, buffer?: Buffer): boolean {
  if (!buffer) {
    return path.extname(filePath).toLowerCase() === PDF_EXTENSION
  }

  if (path.extname(filePath).toLowerCase() !== PDF_EXTENSION) {
    return false
  }

  const searchLimit = Math.min(buffer.length, PDF_MAGIC_SEARCH_LIMIT)
  return buffer.subarray(0, searchLimit).includes(PDF_MAGIC_BYTES)
}

/**
 * Gets the MIME type for an image or PDF file.
 *
 * @param filePath - Path to the file
 * @returns MIME type string, or null if not a recognized image/PDF
 */
export function getMimeType(filePath: string): null | string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] ?? null
}

/**
 * Checks if a file is a media file (only images supported at this point). PDFs are handled separately.
 * @param filePath - Path to the file
 */
export function isMediaFile(filePath: string): boolean {
  return isImageFile(filePath)
}

/**
 * Checks if a file is an Office document based on its extension.
 * These files can be parsed for text extraction using officeparser.
 *
 * @param filePath - Path to the file
 * @returns true if the file is an Office document
 */
export function isOfficeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return OFFICE_EXTENSIONS.has(ext)
}

/**
 * Determines if a file should be returned as a base64 attachment.
 *
 * - Images: Always returned as attachment
 * - PDFs: Depends on pdfMode ('base64' = attachment, 'text' = extract text)
 * - Other files: Never returned as attachment
 *
 * @param filePath - Path to the file
 * @param pdfMode - PDF read mode ('text' | 'base64'), defaults to 'text'
 * @returns true if file should be returned as base64 attachment
 */
export function shouldReturnAsAttachment(filePath: string, pdfMode?: 'base64' | 'text'): boolean {
  // Images are always returned as attachments
  if (isImageFile(filePath)) {
    return true
  }

  // PDFs depend on pdfMode (if pdfMode is 'base64', return true)
  if (isPdfFile(filePath) && pdfMode === 'base64') {
    return true
  }

  return false
}
