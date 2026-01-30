/**
 * Types for tool output sanitization.
 *
 * These types define the structure of sanitized tool results,
 * enabling consistent handling of tool outputs across the system.
 *
 */

import type {MessagePart} from './message-types.js'

/**
 * Resource kind categories for media content.
 */
export type ResourceKind = 'audio' | 'binary' | 'image' | 'video'

/**
 * Resource descriptor created during tool output sanitization.
 * Tracks media resources that were extracted and potentially stored as blobs.
 */
export interface ResourceDescriptor {
  /** Original filename if available */
  filename?: string

  /** Kind of resource based on MIME type */
  kind: ResourceKind

  /** MIME type of the resource */
  mimeType: string

  /** Size in bytes if known */
  size?: number

  /** URI reference to the resource (e.g., "blob:abc123") */
  uri: string
}

/**
 * Metadata about the tool execution.
 */
export interface ToolExecutionMeta {
  /** Any additional metadata from the tool */
  additionalMeta?: Record<string, unknown>

  /** Duration of tool execution in milliseconds (if tracked) */
  durationMs?: number

  /** Whether the tool execution succeeded */
  success: boolean

  /** Unique identifier for this tool call */
  toolCallId: string

  /** Name of the tool that was executed */
  toolName: string
}

/**
 * Result of sanitizing a tool output.
 *
 * Contains the sanitized content parts, resource descriptors for any
 * media that was extracted, and metadata about the tool execution.
 */
export interface SanitizedToolResult {
  /** Sanitized content parts ready for message storage */
  content: MessagePart[]

  /** Metadata about the tool execution */
  meta: ToolExecutionMeta

  /**
   * Resource descriptors for media extracted during sanitization.
   * These may reference blob storage if media was persisted.
   */
  resources?: ResourceDescriptor[]
}

/**
 * Options for the tool result sanitization process.
 */
export interface SanitizeToolResultOptions {
  /**
   * Blob storage for persisting large media.
   * If not provided, large media will be truncated or omitted.
   */
  blobStorage?: import('./i-blob-storage.js').IBlobStorage

  /** Duration of tool execution in milliseconds */
  durationMs?: number

  /**
   * Maximum size in bytes for inline media (default: 5KB).
   * Media larger than this will be stored as blob references.
   */
  maxInlineMediaBytes?: number

  /**
   * Maximum length for text content (default: 8000 chars).
   * Longer text will be truncated with head + tail pattern.
   */
  maxTextLength?: number

  /** Whether the tool execution succeeded */
  success: boolean

  /** Unique identifier for this tool call */
  toolCallId: string

  /** Name of the tool that produced the output */
  toolName: string
}

/**
 * Result of normalizing raw tool output to MessagePart array.
 * Intermediate step in the sanitization pipeline.
 */
export interface NormalizedToolOutput {
  /** MIME types detected in the output */
  detectedMimeTypes: string[]

  /** Whether any binary content was detected */
  hasBinaryContent: boolean

  /** Normalized content parts */
  parts: MessagePart[]
}

/**
 * Result of persisting media to blob storage.
 * Intermediate step in the sanitization pipeline.
 */
export interface PersistMediaResult {
  /** Number of blobs created */
  blobsCreated: number

  /** Total bytes stored */
  bytesStored: number

  /** Parts with blob references replacing inline data */
  parts: MessagePart[]

  /** Resource descriptors for persisted media */
  resources: ResourceDescriptor[]
}

/**
 * Configuration for text truncation.
 */
export interface TextTruncationConfig {
  /** Characters to keep from the start (default: 4000) */
  headLength: number

  /** Maximum total length (default: 8000) */
  maxLength: number

  /** Placeholder text for omitted content */
  placeholder: string

  /** Characters to keep from the end (default: 1000) */
  tailLength: number
}

/**
 * Default text truncation configuration.
 */
export const DEFAULT_TEXT_TRUNCATION: TextTruncationConfig = {
  headLength: 4000,
  maxLength: 8000,
  placeholder: '\n... [{count} chars omitted] ...\n',
  tailLength: 1000,
}

/**
 * Default maximum inline media size (5KB).
 */
export const DEFAULT_MAX_INLINE_MEDIA_BYTES = 5 * 1024

/**
 * MIME types that should always be stored as blobs regardless of size.
 */
export const ALWAYS_BLOB_MIME_TYPES = [
  'audio/',
  'video/',
]

/**
 * Check if a MIME type should always be stored as a blob.
 */
export function shouldAlwaysBlob(mimeType: string): boolean {
  return ALWAYS_BLOB_MIME_TYPES.some((prefix) => mimeType.toLowerCase().startsWith(prefix))
}

/**
 * Infer resource kind from MIME type.
 */
export function inferResourceKind(mimeType: string): ResourceKind {
  const lower = mimeType.toLowerCase()
  if (lower.startsWith('image/')) return 'image'
  if (lower.startsWith('audio/')) return 'audio'
  if (lower.startsWith('video/')) return 'video'
  return 'binary'
}
