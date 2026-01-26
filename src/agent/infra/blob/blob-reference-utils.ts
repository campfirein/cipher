/**
 * Blob reference utilities for lazy media evaluation.
 *
 * Blob references are URIs that point to data stored in blob storage.
 * Format: @blob:{id}
 *
 * This allows messages to reference large media without embedding the
 * actual data, deferring resolution to format-time when needed.
 *
 * Based on dexto's @blob: reference pattern.
 */

/**
 * Regular expression for matching blob references.
 * Captures the blob ID from @blob:{id} format.
 */
export const BLOB_REF_PATTERN = /@blob:([a-zA-Z0-9_-]+)/g

/**
 * Prefix for blob references.
 */
export const BLOB_REF_PREFIX = '@blob:'

/**
 * Check if a string contains any blob references.
 *
 * @param content - String to check
 * @returns true if content contains @blob: references
 */
export function containsBlobReferences(content: string): boolean {
  if (!content || typeof content !== 'string') return false
  return content.includes(BLOB_REF_PREFIX)
}

/**
 * Parse all blob references from a string.
 *
 * @param content - String containing blob references
 * @returns Array of blob IDs (without @blob: prefix)
 */
export function parseBlobReferences(content: string): string[] {
  if (!content || typeof content !== 'string') return []

  const matches = [...content.matchAll(new RegExp(BLOB_REF_PATTERN.source, 'g'))]
  return matches.map((m) => m[1])
}

/**
 * Create a blob reference string from a blob ID.
 *
 * @param blobId - The blob storage key
 * @returns Blob reference string (@blob:{id})
 */
export function createBlobRef(blobId: string): string {
  return `${BLOB_REF_PREFIX}${blobId}`
}

/**
 * Extract blob ID from a reference string.
 *
 * @param ref - Blob reference string (@blob:{id})
 * @returns Blob ID or null if not a valid reference
 */
export function extractBlobId(ref: string): null | string {
  if (!ref || typeof ref !== 'string') return null
  if (!ref.startsWith(BLOB_REF_PREFIX)) return null
  return ref.slice(BLOB_REF_PREFIX.length)
}

/**
 * Check if a string is a blob reference.
 *
 * @param value - String to check
 * @returns true if the string is a blob reference
 */
export function isBlobReference(value: string): boolean {
  if (!value || typeof value !== 'string') return false
  return value.startsWith(BLOB_REF_PREFIX) && extractBlobId(value) !== null
}

/**
 * Check if a MIME type matches a pattern.
 *
 * Supports exact match, wildcard subtype (image/*), and wildcard all.
 *
 * @param mimeType - MIME type to check
 * @param pattern - Pattern to match against
 * @returns true if the MIME type matches the pattern
 */
export function matchesMimePattern(mimeType: string | undefined, pattern: string): boolean {
  if (!mimeType) return false

  const normalizedMime = mimeType.toLowerCase().trim()
  const normalizedPattern = pattern.toLowerCase().trim()

  // Any type
  if (normalizedPattern === '*' || normalizedPattern === '*/*') return true

  // Exact match
  if (normalizedMime === normalizedPattern) return true

  // Wildcard subtype (e.g., "image/*")
  if (normalizedPattern.endsWith('/*')) {
    const patternType = normalizedPattern.slice(0, -2)
    const mimeTypePrefix = normalizedMime.split('/')[0]
    return mimeTypePrefix === patternType
  }

  return false
}

/**
 * Check if a MIME type matches any pattern in an array.
 *
 * @param mimeType - MIME type to check
 * @param patterns - Array of patterns to match against
 * @returns true if the MIME type matches any pattern
 */
export function matchesAnyMimePattern(mimeType: string | undefined, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return true // No filter = allow all
  return patterns.some((pattern) => matchesMimePattern(mimeType, pattern))
}

/**
 * Format byte size as human-readable string.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string like "1.5 KB" or "2.3 MB"
 */
export function formatByteSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

/**
 * Generate a placeholder string for filtered/unavailable media.
 *
 * @param metadata - Media metadata
 * @param metadata.mimeType - MIME type of the media
 * @param metadata.originalName - Original filename if available
 * @param metadata.size - Size in bytes
 * @returns Placeholder string like "[Video: demo.mp4 (5.2 MB)]"
 */
export function generateMediaPlaceholder(metadata: {
  mimeType: string
  originalName?: string
  size: number
}): string {
  let typeLabel = 'File'
  if (metadata.mimeType.startsWith('video/')) typeLabel = 'Video'
  else if (metadata.mimeType.startsWith('audio/')) typeLabel = 'Audio'
  else if (metadata.mimeType.startsWith('image/')) typeLabel = 'Image'
  else if (metadata.mimeType === 'application/pdf') typeLabel = 'PDF'

  const size = formatByteSize(metadata.size)
  const name = metadata.originalName || 'unnamed'

  return `[${typeLabel}: ${name} (${size})]`
}

/**
 * Replace a blob reference in a string with resolved content.
 *
 * @param content - String containing blob reference
 * @param blobId - Blob ID to replace
 * @param replacement - Replacement string
 * @returns String with blob reference replaced
 */
export function replaceBlobReference(content: string, blobId: string, replacement: string): string {
  const ref = createBlobRef(blobId)
  return content.replace(ref, replacement)
}

/**
 * Get MIME type category for display purposes.
 *
 * @param mimeType - MIME type
 * @returns Category label
 */
export function getMimeTypeCategory(mimeType: string): string {
  const lower = mimeType.toLowerCase()
  if (lower.startsWith('image/')) return 'Image'
  if (lower.startsWith('video/')) return 'Video'
  if (lower.startsWith('audio/')) return 'Audio'
  if (lower === 'application/pdf') return 'PDF'
  if (lower.startsWith('text/')) return 'Text'
  return 'File'
}

/**
 * File extension to MIME type mapping for common types.
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  '.avi': 'video/x-msvideo',
  '.bmp': 'image/bmp',
  '.css': 'text/css',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tar': 'application/x-tar',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
}

/**
 * Infer MIME type from filename extension.
 *
 * @param filename - Filename with extension
 * @returns MIME type or undefined if not recognized
 */
export function inferMimeTypeFromFilename(filename: string): string | undefined {
  if (!filename) return undefined
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return EXTENSION_TO_MIME[ext]
}
