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
 * PDF extension for special handling.
 */
const PDF_EXTENSION = '.pdf'

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
 * Threshold for non-printable character ratio to consider a file binary.
 * If more than 30% of sampled bytes are non-printable, the file is binary.
 */
const NON_PRINTABLE_THRESHOLD = 0.3

/**
 * Checks if a file is binary based on extension and content analysis.
 *
 * Detection strategy:
 * 1. Fast path: Check against known binary extensions
 * 2. Check for null bytes (definitive binary indicator)
 * 3. Heuristic: If >30% non-printable characters, consider binary
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

  // Skip content check for known text-based formats
  if (isImageFile(filePath) || isPdfFile(filePath)) {
    // Images and PDFs are binary but handled specially
    return true
  }

  // Empty files are not binary
  if (buffer.length === 0) {
    return false
  }

  // Content-based detection
  let nonPrintableCount = 0

  for (const byte of buffer) {
    // Null byte is a definitive binary indicator
    if (byte === 0) {
      return true
    }

    // Count non-printable characters
    // Printable range: tab (9), newline (10), carriage return (13), space (32) to tilde (126)
    if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) {
      nonPrintableCount++
    }
  }

  // If more than 30% non-printable, consider binary
  return nonPrintableCount / buffer.length > NON_PRINTABLE_THRESHOLD
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
 * Checks if a file is a PDF based on its extension.
 *
 * @param filePath - Path to the file
 * @returns true if the file is a PDF
 */
export function isPdfFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === PDF_EXTENSION
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
 * Checks if a file is a media file (image or PDF) that should be
 * returned as a base64 attachment instead of text content.
 *
 * @param filePath - Path to the file
 * @returns true if the file should be returned as an attachment
 */
export function isMediaFile(filePath: string): boolean {
  return isImageFile(filePath) || isPdfFile(filePath)
}
