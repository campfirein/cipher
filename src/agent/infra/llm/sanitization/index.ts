/**
 * Tool output sanitization module.
 *
 * Provides utilities for sanitizing tool outputs:
 * - Base64 detection and parsing
 * - Media persistence to blob storage
 * - Text truncation
 * - Consistent tool result formatting
 */

// Base64 utilities
export {
  base64LengthToBytes,
  createDataUri,
  encodeToBase64,
  extractBase64Content,
  formatByteSize,
  isLikelyBase64String,
  isValidBase64,
  parseDataUri,
  safeBase64Decode,
} from './base64-utils.js'
export type {ParsedDataUri} from './base64-utils.js'

// Tool sanitizer
export {
  createToolSanitizer,
  sanitizeToolResult,
  ToolSanitizer,
} from './tool-sanitizer.js'
