/**
 * Tool Output Processing Layer
 *
 * Handles truncation and file saving for large tool outputs.
 * Prevents context overflow by truncating outputs while preserving critical information.
 *
 * Enhanced with:
 * - Attachment extraction from structured/MCP-style outputs
 * - Title extraction for display
 * - Support for image and file attachments
 */

import { existsSync, promises as fsPromises, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AttachmentPart } from '../../core/interfaces/message-types.js'

/**
 * Configuration for output truncation behavior
 */
export interface TruncationConfig {
  /**
   * Whether to enable truncation
   * @default true
   */
  enabled?: boolean

  /**
   * Number of lines to keep from the end of the output
   * @default 250
   */
  headLines?: number

  /**
   * Number of lines to keep from the start of the output
   * @default 250
   */
  tailLines?: number

  /**
   * Character threshold for triggering truncation
   * @default 50000
   */
  threshold?: number
}

/**
 * Result of output processing
 */
export interface ProcessedOutput {
  /**
   * Attachments extracted from tool output (images, files)
   */
  attachments?: AttachmentPart[]

  /**
   * Processed content (truncated if necessary)
   */
  content: string

  /**
   * Metadata about the processing
   */
  metadata?: {
    /**
     * Original content length before truncation
     */
    originalLength?: number

    /**
     * Path to file where full output was saved
     */
    savedToFile?: string

    /**
     * Whether output was truncated
     */
    truncated?: boolean
  }

  /**
   * Human-readable title for display
   */
  title?: string
}

/**
 * MCP-style content item (text or image)
 */
interface McpContentItem {
  data?: string
  mimeType?: string
  text?: string
  type: 'image' | 'text'
}

/**
 * Structured tool output with potential attachments
 */
interface StructuredToolOutput {
  attachments?: Array<{
    data: string
    filename?: string
    mimeType: string
    type: 'file' | 'image'
  }>
  content?: McpContentItem[] | string
  title?: string
}

/**
 * Default truncation configuration
 */
export const DEFAULT_TRUNCATION_CONFIG: Required<TruncationConfig> = {
  enabled: true,
  headLines: 250,
  tailLines: 250,
  threshold: 50_000,
}

/**
 * Tool output processor with truncation and file saving capabilities
 */
export class ToolOutputProcessor {
  /** Per-command truncation overrides (stricter limits for context-sensitive commands) */
  private static readonly COMMAND_TRUNCATION_OVERRIDES: Record<string, Partial<TruncationConfig>> = {
    curate: { headLines: 50, tailLines: 20, threshold: 10_000 },
    query: { headLines: 100, tailLines: 50, threshold: 20_000 },
  }
  private readonly config: Required<TruncationConfig>

  /**
   * Create a new tool output processor
   *
   * @param config - Truncation configuration
   */
  constructor(config?: TruncationConfig) {
    this.config = {
      ...DEFAULT_TRUNCATION_CONFIG,
      ...config,
    }
  }

  // ==================== PUBLIC METHODS ====================

  /**
   * Process tool output with truncation and file saving
   *
   * If output exceeds threshold:
   * 1. Saves full output to temp file
   * 2. Returns truncated content (head + tail with omission notice)
   * 3. Includes metadata about truncation
   *
   * @param toolName - Name of the tool that produced the output
   * @param output - Raw tool output (any type, will be stringified)
   * @param commandType - Optional command type for per-command truncation overrides
   * @returns Processed output with metadata
   */
  async processOutput(toolName: string, output: unknown, commandType?: string): Promise<ProcessedOutput> {
    const config = this.resolveConfig(commandType)

    // Convert output to string
    const contentString = this.stringify(output)
    const originalLength = contentString.length

    // Check if truncation is needed
    if (!config.enabled || originalLength <= config.threshold) {
      return {
        content: contentString,
      }
    }

    // Save full output to temp file
    const savedFilePath = await this.saveToTempFile(toolName, contentString)

    // Truncate content
    const truncatedContent = this.truncateContent(contentString, config)

    return {
      content: truncatedContent,
      metadata: {
        originalLength,
        savedToFile: savedFilePath,
        truncated: true,
      },
    }
  }

  /**
   * Process structured tool output that may contain attachments.
   *
   * Handles:
   * - MCP-style responses with content array (text + image items)
   * - Structured outputs with explicit attachments array
   * - Title extraction for display
   *
   * @param toolName - Name of the tool that produced the output
   * @param output - Raw tool output (structured or plain)
   * @param commandType - Optional command type for per-command truncation overrides
   * @returns Processed output with attachments and title
   */
  async processStructuredOutput(toolName: string, output: unknown, commandType?: string): Promise<ProcessedOutput> {
    // Try to detect structured output
    if (this.isStructuredOutput(output)) {
      const structured = output as StructuredToolOutput
      const attachments = this.extractAttachments(structured)
      const textContent = this.extractTextContent(structured)

      // Process the text content with truncation
      const processed = await this.processOutput(toolName, textContent, commandType)

      return {
        ...processed,
        attachments: attachments.length > 0 ? attachments : undefined,
        title: structured.title,
      }
    }

    // Try to detect MCP-style content array
    if (this.isMcpContentArray(output)) {
      const contentArray = output as McpContentItem[]
      const attachments = this.extractMcpAttachments(contentArray)
      const textContent = this.extractMcpTextContent(contentArray)

      // Process the text content with truncation
      const processed = await this.processOutput(toolName, textContent, commandType)

      return {
        ...processed,
        attachments: attachments.length > 0 ? attachments : undefined,
      }
    }

    // Fall back to regular processing
    return this.processOutput(toolName, output, commandType)
  }

  // ==================== PRIVATE METHODS (alphabetical order) ====================

  /**
   * Extract attachments from structured output.
   */
  private extractAttachments(structured: StructuredToolOutput): AttachmentPart[] {
    const attachments: AttachmentPart[] = []

    // Extract from explicit attachments array
    if (structured.attachments) {
      for (const att of structured.attachments) {
        attachments.push({
          data: att.data,
          filename: att.filename,
          mime: att.mimeType,
          type: att.type,
        })
      }
    }

    // Extract images from MCP-style content array
    if (Array.isArray(structured.content)) {
      for (const item of structured.content) {
        if (item.type === 'image' && item.data && item.mimeType) {
          attachments.push({
            data: `data:${item.mimeType};base64,${item.data}`,
            mime: item.mimeType,
            type: 'image',
          })
        }
      }
    }

    return attachments
  }

  /**
   * Extract attachments from MCP-style content array.
   */
  private extractMcpAttachments(content: McpContentItem[]): AttachmentPart[] {
    const attachments: AttachmentPart[] = []

    for (const item of content) {
      if (item.type === 'image' && item.data && item.mimeType) {
        attachments.push({
          data: `data:${item.mimeType};base64,${item.data}`,
          mime: item.mimeType,
          type: 'image',
        })
      }
    }

    return attachments
  }

  /**
   * Extract text content from MCP-style content array.
   */
  private extractMcpTextContent(content: McpContentItem[]): string {
    return content
      .filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n')
  }

  /**
   * Extract text content from structured output.
   */
  private extractTextContent(structured: StructuredToolOutput): string {
    if (typeof structured.content === 'string') {
      return structured.content
    }

    if (Array.isArray(structured.content)) {
      return structured.content
        .filter((item) => item.type === 'text' && item.text)
        .map((item) => item.text)
        .join('\n')
    }

    return ''
  }

  /**
   * Fallback stringify for when JSON.stringify fails.
   * Creates a meaningful string representation of objects/arrays.
   *
   * @param value - Value to stringify
   * @param seen - Set to track circular references
   * @param depth - Current depth for limiting recursion
   * @returns String representation
   */
  private fallbackStringify(value: unknown, seen = new WeakSet(), depth = 0): string {
    const MAX_DEPTH = 10

    // Handle primitives
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return `"${value}"`
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'bigint') return `${value}n`
    if (typeof value === 'symbol') return value.toString()
    if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`

    // Handle objects and arrays
    if (typeof value === 'object') {
      // Check for circular reference
      if (seen.has(value)) {
        return '[Circular]'
      }

      seen.add(value)

      // Depth limit
      if (depth > MAX_DEPTH) {
        return Array.isArray(value) ? '[Array]' : '[Object]'
      }

      // Handle arrays
      if (Array.isArray(value)) {
        const items = value.map((item) => this.fallbackStringify(item, seen, depth + 1))
        return `[${items.join(', ')}]`
      }

      // Handle Date
      if (value instanceof Date) {
        return value.toISOString()
      }

      // Handle Error
      if (value instanceof Error) {
        return `[Error: ${value.message}]`
      }

      // Handle plain objects
      const entries = Object.entries(value)
        .map(([key, val]) => `"${key}": ${this.fallbackStringify(val, seen, depth + 1)}`)
      return `{${entries.join(', ')}}`
    }

    // Unknown type
    return '[Unknown]'
  }

  /**
   * Check if output is an MCP-style content array.
   */
  private isMcpContentArray(output: unknown): output is McpContentItem[] {
    if (!Array.isArray(output)) {
      return false
    }

    // Check if all items have a type field
    return output.every(
      (item) => typeof item === 'object' && item !== null && 'type' in item && (item.type === 'text' || item.type === 'image'),
    )
  }

  /**
   * Check if output is a structured output with potential attachments.
   */
  private isStructuredOutput(output: unknown): output is StructuredToolOutput {
    if (typeof output !== 'object' || output === null) {
      return false
    }

    const obj = output as Record<string, unknown>

    // Must have at least one of: content, attachments, or title
    return 'content' in obj || 'attachments' in obj || 'title' in obj
  }

  /**
   * Resolve effective truncation config, applying per-command overrides if applicable.
   */
  private resolveConfig(commandType?: string): Required<TruncationConfig> {
    if (commandType && commandType in ToolOutputProcessor.COMMAND_TRUNCATION_OVERRIDES) {
      return { ...this.config, ...ToolOutputProcessor.COMMAND_TRUNCATION_OVERRIDES[commandType] }
    }

    return this.config
  }

  /**
   * Save content to a temporary file
   *
   * Creates a unique temp file for storing full tool output.
   *
   * @param toolName - Name of the tool
   * @param content - Content to save
   * @returns Path to saved file
   */
  private async saveToTempFile(toolName: string, content: string): Promise<string> {
    // Create temp directory if it doesn't exist
    const tempDir = join(tmpdir(), 'byterover-tool-outputs')

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    // Generate unique filename
    const timestamp = Date.now()
    const sanitizedToolName = toolName.replaceAll(/[^a-z0-9-_]/gi, '_')
    const filename = `${sanitizedToolName}_${timestamp}.txt`
    const filePath = join(tempDir, filename)

    // Write content to file
    await fsPromises.writeFile(filePath, content, 'utf8')

    return filePath
  }

  /**
   * Safely stringify any value
   *
   * Handles circular references and special types.
   *
   * @param value - Value to stringify
   * @returns String representation
   */
  private stringify(value: unknown): string {
    if (typeof value === 'string') {
      return value
    }

    if (value === null || value === undefined) {
      return String(value)
    }

    try {
      // Try JSON.stringify with proper handling for special types
      return JSON.stringify(
        value,
        (_, val) => {
          // Convert BigInt to string
          if (typeof val === 'bigint') {
            return val.toString()
          }

          // Convert functions to their string representation
          if (typeof val === 'function') {
            return `[Function: ${val.name || 'anonymous'}]`
          }

          // Convert Symbols to string
          if (typeof val === 'symbol') {
            return val.toString()
          }

          return val
        },
        2,
      )
    } catch (error) {
      // Fallback: Try to create a meaningful string representation
      // instead of [object Object]
      try {
        return this.fallbackStringify(value)
      } catch {
        // Last resort: Return error description
        return `[Serialization failed: ${error instanceof Error ? error.message : 'Unknown error'}]`
      }
    }
  }

  /**
   * Truncate content keeping head and tail lines
   *
   * Format:
   * [First N lines]
   * ... [omission notice with line count and file reference] ...
   * [Last N lines]
   *
   * @param content - Content to truncate
   * @param config - Truncation config to use (may include per-command overrides)
   * @returns Truncated content
   */
  private truncateContent(content: string, config: Required<TruncationConfig> = this.config): string {
    const lines = content.split('\n')
    const totalLines = lines.length

    // Calculate how many lines to keep
    const headLines = Math.min(config.headLines, totalLines)
    const tailLines = Math.min(config.tailLines, totalLines)

    // If content is small enough to fit, return as-is
    if (headLines + tailLines >= totalLines) {
      return content
    }

    // Extract head and tail
    const head = lines.slice(0, headLines).join('\n')
    const tail = lines.slice(-tailLines).join('\n')

    // Calculate omitted lines
    const omittedLines = totalLines - headLines - tailLines
    const omissionNotice = `\n\n... [${omittedLines} lines omitted - full output saved to file] ...\n\n`

    return head + omissionNotice + tail
  }
}
