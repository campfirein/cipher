/**
 * Blob reference resolver for lazy media evaluation.
 *
 * This service resolves @blob:id references in message content to actual data
 * at format-time (when sending to LLM), enabling lazy evaluation of large media.
 *
 * Key features:
 * - Lazy expansion: Blob references only resolved when needed
 * - MIME type filtering: Exclude unsupported media types
 * - Placeholder generation: Replace filtered media with descriptive placeholders
 *
 */

import type {IBlobStorage} from '../../core/interfaces/i-blob-storage.js'
import type {
  FilePart,
  ImagePart,
  MessagePart,
} from '../../core/interfaces/message-types.js'

import {
  BLOB_REF_PATTERN,
  containsBlobReferences,
  extractBlobId,
  generateMediaPlaceholder,
  matchesAnyMimePattern,
  parseBlobReferences,
} from './blob-reference-utils.js'

/**
 * Options for blob reference expansion.
 */
export interface BlobResolutionOptions {
  /**
   * MIME patterns to allow (e.g., ["image/*", "application/pdf"]).
   * Media not matching any pattern will be replaced with placeholders.
   * If not specified, all media types are allowed.
   */
  allowedMimeTypes?: string[]

  /**
   * Whether to include metadata in resolved parts.
   * Default: false
   */
  includeMetadata?: boolean
}

/**
 * Result of resolving a single blob reference.
 */
export interface ResolvedBlobResult {
  /** Error message if resolution failed */
  error?: string
  /** Resolved message parts (may be multiple if embedded in text) */
  parts: MessagePart[]
  /** Whether resolution was successful */
  success: boolean
}

/**
 * Blob reference resolver.
 *
 * Resolves @blob:id references to actual content at format-time.
 */
export class BlobReferenceResolver {
  constructor(private readonly blobStorage: IBlobStorage) {}

  /**
   * Expand blob references in message content.
   *
   * Processes an array of message parts and resolves any @blob:id references
   * to actual content. Supports blob refs in:
   * - TextPart.text (inline references)
   * - ImagePart.image (blob ref instead of base64)
   * - FilePart.data (blob ref instead of base64)
   *
   * @param content - Array of message parts to expand
   * @param options - Resolution options
   * @returns Array of message parts with blob refs resolved
   */
  async expandBlobReferences(
    content: MessagePart[],
    options?: BlobResolutionOptions,
  ): Promise<MessagePart[]> {
    const expanded: MessagePart[] = []

    const expandedParts = await Promise.all(
      content.map((part) => this.expandPart(part, options)),
    )
    for (const parts of expandedParts) {
      expanded.push(...parts)
    }

    return expanded
  }

  /**
   * Get all blob IDs referenced in content.
   */
  getBlobIds(content: MessagePart[]): string[] {
    const ids = new Set<string>()

    for (const part of content) {
      if (part.type === 'text') {
        for (const id of parseBlobReferences(part.text)) {
          ids.add(id)
        }
      }

      if (part.type === 'image' && typeof part.image === 'string') {
        const id = extractBlobId(part.image)
        if (id) ids.add(id)
      }

      if (part.type === 'file' && typeof part.data === 'string') {
        const id = extractBlobId(part.data)
        if (id) ids.add(id)
      }
    }

    return [...ids]
  }

  /**
   * Check if content contains any blob references.
   *
   * Useful for determining if expansion is needed before calling expandBlobReferences.
   */
  hasAnyBlobReferences(content: MessagePart[]): boolean {
    for (const part of content) {
      if (part.type === 'text' && containsBlobReferences(part.text)) {
        return true
      }

      if (part.type === 'image' && typeof part.image === 'string' && part.image.startsWith('@blob:')) {
        return true
      }

      if (part.type === 'file' && typeof part.data === 'string' && part.data.startsWith('@blob:')) {
        return true
      }
    }

    return false
  }

  /**
   * Prefetch blobs for a set of message parts.
   *
   * Useful for warming the cache before expansion.
   */
  async prefetchBlobs(content: MessagePart[]): Promise<void> {
    const ids = this.getBlobIds(content)
    await Promise.all(ids.map((id) => this.blobStorage.retrieve(id)))
  }

  /**
   * Expand blob references embedded in text.
   *
   * Text like "Here is the image: @blob:abc123" will be split into
   * multiple parts: text before, image part, text after.
   */
  private async expandBlobsInText(
    text: string,
    options?: BlobResolutionOptions,
  ): Promise<MessagePart[]> {
    const blobIds = parseBlobReferences(text)
    if (blobIds.length === 0) {
      return [{text, type: 'text'}]
    }

    const parts: MessagePart[] = []
    let lastIndex = 0
    const matches = [...text.matchAll(new RegExp(BLOB_REF_PATTERN.source, 'g'))]

    const resolvedParts = await Promise.all(
      matches.map((match) => {
        const blobId = match[1]
        return this.resolveBlobToParts(blobId, options)
      }),
    )

    for (const [index, match] of matches.entries()) {
      const matchIndex = match.index!

      // Add text before this match
      if (matchIndex > lastIndex) {
        const segment = text.slice(lastIndex, matchIndex)
        if (segment.length > 0) {
          parts.push({text: segment, type: 'text'})
        }
      }

      // Resolve the blob
      parts.push(...resolvedParts[index])

      lastIndex = matchIndex + match[0].length
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const trailing = text.slice(lastIndex)
      if (trailing.length > 0) {
        parts.push({text: trailing, type: 'text'})
      }
    }

    return parts
  }

  /**
   * Expand a single message part.
   */
  private async expandPart(
    part: MessagePart,
    options?: BlobResolutionOptions,
  ): Promise<MessagePart[]> {
    // Text part with embedded blob refs
    if (part.type === 'text' && containsBlobReferences(part.text)) {
      return this.expandBlobsInText(part.text, options)
    }

    // Image part with blob ref
    if (part.type === 'image' && typeof part.image === 'string' && part.image.startsWith('@blob:')) {
      const resolved = await this.resolveImageBlob(part, options)
      return [resolved]
    }

    // File part with blob ref
    if (part.type === 'file' && typeof part.data === 'string' && part.data.startsWith('@blob:')) {
      const resolved = await this.resolveFileBlob(part, options)
      return [resolved]
    }

    // No blob refs, return as-is
    return [part]
  }

  /**
   * Resolve a blob ID to message parts.
   */
  private async resolveBlobToParts(
    blobId: string,
    options?: BlobResolutionOptions,
  ): Promise<MessagePart[]> {
    try {
      const blob = await this.blobStorage.retrieve(blobId)
      if (!blob) {
        return [{text: `[Attachment unavailable: @blob:${blobId}]`, type: 'text'}]
      }

      const mimeType = blob.metadata.contentType || 'application/octet-stream'

      // Check MIME type filtering
      if (options?.allowedMimeTypes && !matchesAnyMimePattern(mimeType, options.allowedMimeTypes)) {
        const placeholder = generateMediaPlaceholder({
          mimeType,
          originalName: blob.metadata.originalName,
          size: blob.metadata.size,
        })
        return [{text: placeholder, type: 'text'}]
      }

      // Convert to appropriate part type
      const base64Content = blob.content.toString('base64')

      if (mimeType.startsWith('image/')) {
        return [{
          image: base64Content,
          mimeType,
          type: 'image',
        }]
      }

      return [{
        data: base64Content,
        mimeType,
        type: 'file',
        ...(blob.metadata.originalName && {filename: blob.metadata.originalName}),
      }]
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return [{text: `[Attachment unavailable: @blob:${blobId} - ${message}]`, type: 'text'}]
    }
  }

  /**
   * Resolve a file part with blob reference.
   */
  private async resolveFileBlob(
    part: FilePart,
    options?: BlobResolutionOptions,
  ): Promise<MessagePart> {
    const blobId = extractBlobId(part.data as string)
    if (!blobId) return part

    const resolved = await this.resolveBlobToParts(blobId, options)

    // If resolved to a file part, preserve the original filename
    if (resolved[0]?.type === 'file' && part.filename && !resolved[0].filename) {
      return {...resolved[0], filename: part.filename}
    }

    return resolved[0] || part
  }

  /**
   * Resolve an image part with blob reference.
   */
  private async resolveImageBlob(
    part: ImagePart,
    options?: BlobResolutionOptions,
  ): Promise<MessagePart> {
    const blobId = extractBlobId(part.image as string)
    if (!blobId) return part

    const resolved = await this.resolveBlobToParts(blobId, options)
    return resolved[0] || part
  }
}

/**
 * Create a BlobReferenceResolver instance.
 */
export function createBlobReferenceResolver(blobStorage: IBlobStorage): BlobReferenceResolver {
  return new BlobReferenceResolver(blobStorage)
}
