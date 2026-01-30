/**
 * Tool output sanitization pipeline.
 *
 * This module provides a comprehensive sanitization pipeline for tool outputs:
 * 1. normalize() - Convert arbitrary tool output to MessagePart[]
 * 2. persistMedia() - Store large media as blob references
 * 3. applySanitization() - Apply final cleanup (truncation, etc.)
 *
 */

import type {IBlobStorage} from '../../../core/interfaces/i-blob-storage.js'
import type {
  FilePart,
  ImagePart,
  MessagePart,
  TextPart,
} from '../../../core/interfaces/message-types.js'
import type {
  NormalizedToolOutput,
  PersistMediaResult,
  ResourceDescriptor,
  SanitizedToolResult,
  SanitizeToolResultOptions,
} from '../../../core/interfaces/sanitization-types.js'

import {
  DEFAULT_MAX_INLINE_MEDIA_BYTES,
  DEFAULT_TEXT_TRUNCATION,
  inferResourceKind,
  shouldAlwaysBlob,
} from '../../../core/interfaces/sanitization-types.js'
import {
  base64LengthToBytes,
  formatByteSize,
  isLikelyBase64String,
  parseDataUri,
} from './base64-utils.js'

/**
 * Tool output sanitizer.
 *
 * Provides a pipeline for sanitizing tool outputs:
 * - Normalizes arbitrary output formats to MessagePart[]
 * - Stores large media in blob storage with lazy references
 * - Applies text truncation and cleanup
 */
export class ToolSanitizer {
  private readonly blobStorage?: IBlobStorage
  private readonly maxInlineMediaBytes: number
  private readonly maxTextLength: number

  constructor(options?: {
    blobStorage?: IBlobStorage
    maxInlineMediaBytes?: number
    maxTextLength?: number
  }) {
    this.blobStorage = options?.blobStorage
    this.maxInlineMediaBytes = options?.maxInlineMediaBytes ?? DEFAULT_MAX_INLINE_MEDIA_BYTES
    this.maxTextLength = options?.maxTextLength ?? DEFAULT_TEXT_TRUNCATION.maxLength
  }

  /**
   * Step 3: Apply final sanitization (truncation, etc.).
   */
  applySanitization(parts: MessagePart[], maxTextLength?: number): MessagePart[] {
    const maxLen = maxTextLength ?? this.maxTextLength

    return parts.map((part) => {
      if (part.type === 'text' && part.text.length > maxLen) {
        return {
          text: this.truncateText(part.text, maxLen),
          type: 'text',
        } as TextPart
      }

      return part
    })
  }

  /**
   * Step 1: Normalize arbitrary tool output to MessagePart array.
   */
  normalize(result: unknown): NormalizedToolOutput {
    const detectedMimeTypes: string[] = []
    let hasBinaryContent = false

    const parts = this.normalizeValue(result, detectedMimeTypes, (isBinary) => {
      if (isBinary) hasBinaryContent = true
    })

    return {
      detectedMimeTypes: [...new Set(detectedMimeTypes)],
      hasBinaryContent,
      parts,
    }
  }

  /**
   * Step 2: Persist large media to blob storage.
   */
  async persistMedia(
    parts: MessagePart[],
    toolName: string,
    toolCallId: string,
    maxInlineBytes?: number,
  ): Promise<PersistMediaResult> {
    const threshold = maxInlineBytes ?? this.maxInlineMediaBytes
    const resources: ResourceDescriptor[] = []
    const persistedParts: MessagePart[] = []
    let blobsCreated = 0
    let bytesStored = 0

    const persistPromises = parts.map(async (part) => {
      if (part.type === 'image' && typeof part.image === 'string') {
        return this.persistImageIfNeeded(
          part,
          toolName,
          toolCallId,
          threshold,
        )
      }

      if (part.type === 'file' && typeof part.data === 'string') {
        return this.persistFileIfNeeded(
          part,
          toolName,
          toolCallId,
          threshold,
        )
      }

      return {part}
    })

    const persistedResults = await Promise.all(persistPromises)

    for (const persisted of persistedResults) {
      persistedParts.push(persisted.part)

      if (persisted.resource) {
        resources.push(persisted.resource)
        blobsCreated++
        bytesStored += persisted.resource.size ?? 0
      }
    }

    return {blobsCreated, bytesStored, parts: persistedParts, resources}
  }

  /**
   * Sanitize a tool result through the full pipeline.
   */
  async sanitize(
    result: unknown,
    options: SanitizeToolResultOptions,
  ): Promise<SanitizedToolResult> {
    // Step 1: Normalize to MessagePart[]
    const normalized = this.normalize(result)

    // Step 2: Persist large media to blob storage
    const persisted = await this.persistMedia(
      normalized.parts,
      options.toolName,
      options.toolCallId,
      options.maxInlineMediaBytes,
    )

    // Step 3: Apply final sanitization
    const sanitizedParts = this.applySanitization(persisted.parts, options.maxTextLength)

    return {
      content: sanitizedParts,
      ...(persisted.resources.length > 0 && {resources: persisted.resources}),
      meta: {
        success: options.success,
        toolCallId: options.toolCallId,
        toolName: options.toolName,
        ...(options.durationMs !== undefined && {durationMs: options.durationMs}),
      },
    }
  }

  private extractData(data: unknown): string {
    if (typeof data === 'string') return data
    if (Buffer.isBuffer(data)) return data.toString('base64')
    if (data instanceof Uint8Array) return Buffer.from(data).toString('base64')
    if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('base64')
    return String(data)
  }

  private generateBlobId(toolName: string, toolCallId: string): string {
    const sanitizedTool = toolName.replaceAll(/[^a-z0-9]/gi, '_').slice(0, 20)
    const sanitizedCall = toolCallId.replaceAll(/[^a-z0-9]/gi, '_').slice(0, 10)
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).slice(2, 6)
    return `${sanitizedTool}_${sanitizedCall}_${timestamp}_${random}`
  }

  private normalizeArray(
    array: unknown[],
    detectedMimeTypes: string[],
    onBinary: (isBinary: boolean) => void,
  ): MessagePart[] {
    const parts: MessagePart[] = []

    for (const item of array) {
      if (!item || typeof item !== 'object') continue

      const obj = item as Record<string, unknown>
      const itemParts = this.normalizeArrayItem(obj, detectedMimeTypes, onBinary)

      if (itemParts.length > 0) {
        parts.push(...itemParts)
      }
    }

    return parts.length > 0 ? parts : [{text: JSON.stringify(array), type: 'text'}]
  }

  private normalizeArrayItem(
    obj: Record<string, unknown>,
    detectedMimeTypes: string[],
    onBinary: (isBinary: boolean) => void,
  ): MessagePart[] {
    // MCP text content
    if (obj.type === 'text' && typeof obj.text === 'string') {
      return [{text: obj.text, type: 'text'}]
    }

    // MCP image content
    if (obj.type === 'image' && obj.data && obj.mimeType) {
      const mimeType = obj.mimeType as string
      detectedMimeTypes.push(mimeType)
      onBinary(true)
      return [{
        image: obj.data as string,
        mimeType,
        type: 'image',
      }]
    }

    // MCP resource content
    if (obj.type === 'resource' && obj.resource) {
      return this.normalizeResourceContent(
        obj.resource as Record<string, unknown>,
        detectedMimeTypes,
        onBinary,
      )
    }

    // Nested object - recursively normalize
    return this.normalizeValue(obj, detectedMimeTypes, onBinary)
  }

  private normalizeObject(
    obj: Record<string, unknown>,
    detectedMimeTypes: string[],
    onBinary: (isBinary: boolean) => void,
  ): MessagePart[] {
    // Check for nested content array
    if ('content' in obj && Array.isArray(obj.content)) {
      return this.normalizeArray(obj.content, detectedMimeTypes, onBinary)
    }

    // { image, mimeType? }
    if ('image' in obj) {
      const mimeType = (obj.mimeType as string) || 'image/jpeg'
      detectedMimeTypes.push(mimeType)
      onBinary(true)

      return [{
        image: this.extractData(obj.image),
        mimeType,
        type: 'image',
      }]
    }

    // { data, mimeType }
    if ('data' in obj && obj.mimeType) {
      const mimeType = obj.mimeType as string
      detectedMimeTypes.push(mimeType)
      onBinary(true)

      const filePart: FilePart = {
        data: this.extractData(obj.data),
        mimeType,
        type: 'file',
      }

      if (obj.filename && typeof obj.filename === 'string') {
        filePart.filename = obj.filename
      }

      return [filePart]
    }

    // Generic object - sanitize and stringify
    const cleaned = this.sanitizeDeepObject(obj)
    return [{text: JSON.stringify(cleaned, null, 2), type: 'text'}]
  }

  private normalizeResourceContent(
    resource: Record<string, unknown>,
    detectedMimeTypes: string[],
    onBinary: (isBinary: boolean) => void,
  ): MessagePart[] {
    if (!resource.text && !resource.blob) {
      return []
    }

    const mimeType = (resource.mimeType as string) || 'application/octet-stream'
    const data = (resource.blob || resource.text) as string
    detectedMimeTypes.push(mimeType)

    if (mimeType.startsWith('image/')) {
      onBinary(true)
      return [{image: data, mimeType, type: 'image'}]
    }

    if (resource.blob || isLikelyBase64String(data)) {
      onBinary(true)

      const filePart: FilePart = {
        data,
        mimeType,
        type: 'file',
      }

      if (resource.title && typeof resource.title === 'string') {
        filePart.filename = resource.title
      }

      return [filePart]
    }

    return [{text: data, type: 'text'}]
  }

  private normalizeString(
    value: string,
    detectedMimeTypes: string[],
    onBinary: (isBinary: boolean) => void,
  ): MessagePart[] {
    // Check for data URI
    const dataUri = parseDataUri(value)
    if (dataUri) {
      detectedMimeTypes.push(dataUri.mediaType)
      onBinary(true)

      if (dataUri.mediaType.startsWith('image/')) {
        return [{image: dataUri.base64, mimeType: dataUri.mediaType, type: 'image'}]
      }

      return [{data: dataUri.base64, mimeType: dataUri.mediaType, type: 'file'}]
    }

    // Check for likely base64 blob
    if (isLikelyBase64String(value)) {
      onBinary(true)
      // Can't determine MIME type, treat as binary
      return [{data: value, mimeType: 'application/octet-stream', type: 'file'}]
    }

    // Regular text
    return [{text: value, type: 'text'}]
  }

  private normalizeValue(
    value: unknown,
    detectedMimeTypes: string[],
    onBinary: (isBinary: boolean) => void,
  ): MessagePart[] {
    // Null/undefined
    if (value === null || value === undefined) {
      return [{text: '', type: 'text'}]
    }

    // String input
    if (typeof value === 'string') {
      return this.normalizeString(value, detectedMimeTypes, onBinary)
    }

    // Array input (MCP-style content)
    if (Array.isArray(value)) {
      return this.normalizeArray(value, detectedMimeTypes, onBinary)
    }

    // Object input
    if (typeof value === 'object') {
      return this.normalizeObject(value as Record<string, unknown>, detectedMimeTypes, onBinary)
    }

    // Primitive fallback
    return [{text: String(value), type: 'text'}]
  }

  private async persistFileIfNeeded(
    part: FilePart,
    toolName: string,
    toolCallId: string,
    threshold: number,
  ): Promise<{part: MessagePart; resource?: ResourceDescriptor}> {
    const {data, filename, mimeType} = part
    const dataString = data as string
    const approxBytes = base64LengthToBytes(dataString.length)
    const shouldPersist = shouldAlwaysBlob(mimeType) || approxBytes >= threshold

    if (!shouldPersist || !this.blobStorage) {
      return {part}
    }

    const blobId = await this.storeAsBlob({
      data: dataString,
      filename,
      mimeType,
      toolCallId,
      toolName,
    })
    if (!blobId) {
      return {part}
    }

    return {
      part: {
        data: `@blob:${blobId}`,
        ...(filename && {filename}),
        mimeType,
        type: 'file',
      },
      resource: {
        ...(filename && {filename}),
        kind: inferResourceKind(mimeType),
        mimeType,
        size: approxBytes,
        uri: `blob:${blobId}`,
      },
    }
  }

  private async persistImageIfNeeded(
    part: ImagePart,
    toolName: string,
    toolCallId: string,
    threshold: number,
  ): Promise<{part: MessagePart; resource?: ResourceDescriptor}> {
    const data = part.image as string
    const mimeType = part.mimeType || 'image/jpeg'
    const approxBytes = base64LengthToBytes(data.length)
    const shouldPersist = shouldAlwaysBlob(mimeType) || approxBytes >= threshold

    if (!shouldPersist || !this.blobStorage) {
      return {part}
    }

    const blobId = await this.storeAsBlob({
      data,
      mimeType,
      toolCallId,
      toolName,
    })
    if (!blobId) {
      return {part}
    }

    return {
      part: {
        image: `@blob:${blobId}`,
        mimeType,
        type: 'image',
      },
      resource: {
        kind: 'image',
        mimeType,
        size: approxBytes,
        uri: `blob:${blobId}`,
      },
    }
  }

  /**
   * Recursively sanitize object, replacing large base64 with placeholders.
   */
  private sanitizeDeepObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj

    if (typeof obj === 'string') {
      if (isLikelyBase64String(obj)) {
        const approxBytes = base64LengthToBytes(obj.length)
        return `[binary data omitted ~${formatByteSize(approxBytes)}]`
      }

      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map((x) => this.sanitizeDeepObject(x))
    }

    if (typeof obj === 'object') {
      const out: Record<string, unknown> = {}

      for (const [k, v] of Object.entries(obj)) {
        out[k] = this.sanitizeDeepObject(v)
      }

      return out
    }

    return obj
  }

  private async storeAsBlob(options: {
    data: string
    filename?: string
    mimeType: string
    toolCallId: string
    toolName: string
  }): Promise<null | string> {
    if (!this.blobStorage) return null

    try {
      const blobId = this.generateBlobId(options.toolName, options.toolCallId)
      const buffer = Buffer.from(options.data, 'base64')

      await this.blobStorage.store(blobId, buffer, {
        contentType: options.mimeType,
        originalName: options.filename,
        tags: {source: 'tool', toolCallId: options.toolCallId, toolName: options.toolName},
      })

      return blobId
    } catch {
      return null
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text

    const {headLength, placeholder, tailLength} = DEFAULT_TEXT_TRUNCATION
    const omittedCount = text.length - headLength - tailLength

    const head = text.slice(0, headLength)
    const tail = text.slice(-tailLength)
    const replacedPlaceholder = placeholder.replace('{count}', String(omittedCount))

    return `${head}${replacedPlaceholder}${tail}`
  }
}

/**
 * Create a ToolSanitizer instance.
 */
export function createToolSanitizer(options?: {
  blobStorage?: IBlobStorage
  maxInlineMediaBytes?: number
  maxTextLength?: number
}): ToolSanitizer {
  return new ToolSanitizer(options)
}

/**
 * Convenience function to sanitize a tool result with default options.
 */
export async function sanitizeToolResult(
  result: unknown,
  options: SanitizeToolResultOptions,
): Promise<SanitizedToolResult> {
  const sanitizer = new ToolSanitizer({
    blobStorage: options.blobStorage,
    maxInlineMediaBytes: options.maxInlineMediaBytes,
    maxTextLength: options.maxTextLength,
  })
  return sanitizer.sanitize(result, options)
}
