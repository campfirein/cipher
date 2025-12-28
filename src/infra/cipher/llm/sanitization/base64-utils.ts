/**
 * Base64 detection and parsing utilities for tool output sanitization.
 *
 * These utilities help identify and process base64-encoded content in tool outputs,
 * enabling the sanitization pipeline to detect and handle binary data appropriately.
 *
 * Based on dexto's isLikelyBase64String() and parseDataUri() patterns.
 */

/**
 * Default minimum length for base64 heuristic detection.
 * Strings shorter than this are unlikely to be meaningful base64 blobs.
 */
const MIN_BASE64_HEURISTIC_LENGTH = 512

/**
 * Regular expression for valid base64 characters.
 * Includes standard base64 alphabet plus padding and optional whitespace.
 */
const BASE64_CHARSET_REGEX = /^[A-Za-z0-9+/=\r\n\s]+$/

/**
 * Check if a string is likely a Base64-encoded binary blob.
 *
 * Uses heuristics to detect base64 content:
 * 1. Length threshold (default 512 chars)
 * 2. Character set matching (base64 alphabet only)
 * 3. Low non-base64 character ratio
 *
 * This is intentionally conservative to avoid false positives on
 * normal text that happens to look like base64.
 *
 * @param value - The string to check
 * @param minLength - Minimum length threshold (default: 512)
 * @returns true if the string is likely base64-encoded binary data
 */
export function isLikelyBase64String(
  value: string,
  minLength: number = MIN_BASE64_HEURISTIC_LENGTH,
): boolean {
  if (!value || typeof value !== 'string') return false
  if (value.length < minLength) return false

  // Fast-path for data URIs which explicitly declare base64
  if (value.startsWith('data:') && value.includes(';base64,')) return true

  // Check character set - must be valid base64 characters
  if (!BASE64_CHARSET_REGEX.test(value)) return false

  // Calculate non-base64 character ratio (whitespace excluded)
  const strippedValue = value.replaceAll(/[\r\n\s]/g, '')
  const nonBase64Count = (strippedValue.match(/[^A-Za-z0-9+/=]/g) || []).length
  const nonBase64Ratio = nonBase64Count / strippedValue.length

  // Very low ratio of non-base64 chars suggests actual base64
  return nonBase64Ratio < 0.01
}

/**
 * Result of parsing a data URI.
 */
export interface ParsedDataUri {
  /** The base64-encoded content */
  base64: string
  /** The MIME type from the data URI */
  mediaType: string
}

/**
 * Parse a data URI and extract media type and base64 content.
 *
 * Supports the standard data URI format:
 * data:[<mediatype>][;base64],<data>
 *
 * @param value - The data URI string to parse
 * @returns Parsed components or null if not a valid base64 data URI
 */
export function parseDataUri(value: string): null | ParsedDataUri {
  if (!value || typeof value !== 'string') return null
  if (!value.startsWith('data:')) return null

  const commaIndex = value.indexOf(',')
  if (commaIndex === -1) return null

  const meta = value.slice(5, commaIndex) // Skip 'data:'

  // Must be base64 encoded
  if (!/;base64$/i.test(meta)) return null

  const mediaType = meta.replace(/;base64$/i, '') || 'application/octet-stream'
  const base64 = value.slice(commaIndex + 1)

  return {base64, mediaType}
}

/**
 * Estimate byte length from base64 string length.
 *
 * Base64 encoding uses 4 characters to represent 3 bytes.
 * This approximation is useful for size threshold checks.
 *
 * @param charLength - Length of the base64 string
 * @returns Approximate byte count of the decoded data
 */
export function base64LengthToBytes(charLength: number): number {
  // Remove padding chars from calculation for accuracy
  const paddingChars = charLength > 0 ? (charLength % 4 === 0 ? 0 : 4 - (charLength % 4)) : 0
  return Math.floor(((charLength - paddingChars) * 3) / 4)
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
 * Check if a value is a valid base64 string (strict check).
 *
 * Unlike isLikelyBase64String which uses heuristics, this performs
 * a stricter validation that the string is valid base64 format.
 *
 * @param value - The string to validate
 * @returns true if valid base64 format
 */
export function isValidBase64(value: string): boolean {
  if (!value || typeof value !== 'string') return false

  // Remove whitespace
  const cleaned = value.replaceAll(/[\r\n\s]/g, '')

  // Check length is multiple of 4
  if (cleaned.length % 4 !== 0) return false

  // Check character set
  return /^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)
}

/**
 * Safely decode base64 string to Buffer.
 *
 * @param base64 - Base64 encoded string
 * @returns Decoded Buffer or null if invalid
 */
export function safeBase64Decode(base64: string): Buffer | null {
  try {
    // Remove whitespace
    const cleaned = base64.replaceAll(/[\r\n\s]/g, '')

    // Validate before decoding
    if (!isValidBase64(cleaned)) return null

    return Buffer.from(cleaned, 'base64')
  } catch {
    return null
  }
}

/**
 * Encode data to base64 string.
 *
 * @param data - Data to encode (Buffer, Uint8Array, or string)
 * @returns Base64 encoded string
 */
export function encodeToBase64(data: Buffer | string | Uint8Array): string {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8').toString('base64')
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('base64')
  }

  // At this point, data must be Uint8Array
  return Buffer.from(data).toString('base64')
}

/**
 * Create a data URI from base64 content and MIME type.
 *
 * @param base64 - Base64 encoded content
 * @param mimeType - MIME type of the content
 * @returns Data URI string
 */
export function createDataUri(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`
}

/**
 * Extract base64 content from a data URI or return the original if not a data URI.
 *
 * @param value - Data URI or raw base64 string
 * @returns Object with base64 content and optional MIME type
 */
export function extractBase64Content(value: string): {base64: string; mimeType?: string} {
  const parsed = parseDataUri(value)

  if (parsed) {
    return {base64: parsed.base64, mimeType: parsed.mediaType}
  }

  return {base64: value}
}
