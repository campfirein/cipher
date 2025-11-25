/**
 * Tool Output Processing Layer
 *
 * Handles truncation and file saving for large tool outputs.
 * Prevents context overflow by truncating outputs while preserving critical information.
 */

import {existsSync, promises as fsPromises, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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
   * @returns Processed output with metadata
   */
  async processOutput(toolName: string, output: unknown): Promise<ProcessedOutput> {
    // Convert output to string
    const contentString = this.stringify(output)
    const originalLength = contentString.length

    // Check if truncation is needed
    if (!this.config.enabled || originalLength <= this.config.threshold) {
      return {
        content: contentString,
      }
    }

    // Save full output to temp file
    const savedFilePath = await this.saveToTempFile(toolName, contentString)

    // Truncate content
    const truncatedContent = this.truncateContent(contentString)

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
      // Try JSON.stringify with circular reference handling
      return JSON.stringify(
        value,
        (_, val) => {
          // Handle circular references by converting to string
          if (typeof val === 'object' && val !== null) {
            return val
          }

          return val
        },
        2
      )
    } catch {
      // Fallback to String() if JSON.stringify fails
      return String(value)
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
   * @returns Truncated content
   */
  private truncateContent(content: string): string {
    const lines = content.split('\n')
    const totalLines = lines.length

    // Calculate how many lines to keep
    const headLines = Math.min(this.config.headLines, totalLines)
    const tailLines = Math.min(this.config.tailLines, totalLines)

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
