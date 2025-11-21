/**
 * Cursor Clean Service
 * Transforms Cursor raw parsed data to clean normalized format
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import {
  CleanCursorToolResultBlock,
  CleanCursorToolUseBlock,
  CursorBubble,
  CursorToolResult,
  RawCursorRawSession,
} from '../../../core/domain/entities/parser.js'
import { ICleanParserService } from '../../../core/interfaces/parser/i-clean-parser-service.js'
import { normalizeClaudeSession } from './shared.js'

/**
 * Cursor Clean Service
 * Transforms Cursor raw parsed sessions to clean normalized format
 */
export class CursorCleanService implements ICleanParserService {
  private ide: Agent

  /**
   * Initialize Cursor Clean Service
   *
   * @param ide - The IDE type (Cursor)
   */
  constructor(ide: Agent) {
    this.ide = ide
  }

  /**
   * Parse and transform Cursor raw sessions to clean normalized format
   *
   * Reads Cursor raw session files organized by workspace, transforms them using
   * Cursor-to-Claude conversion, and writes the normalized sessions to the output directory.
   * Each session is transformed through Cursor bubble format conversion and then normalized.
   *
   * @param rawDir - Absolute path to the directory containing raw Cursor session files organized by workspace
   * @returns Promise that resolves to true if parsing succeeded, false otherwise
   */
  /* eslint-disable no-await-in-loop */
  async parse(rawDir: string): Promise<boolean> {
    const outputDir = pathJoin(process.cwd(), `.brv/logs/${this.ide}/clean`)

    console.log('🔍 Starting Cursor clean transformation...')
    console.log(`📁 Raw directory: ${rawDir}`)

    try {
      await mkdir(outputDir, { recursive: true })

      // Read raw sessions organized by workspace
      const entries = await readdir(rawDir)

      let totalSessions = 0

      for (const entry of entries) {
        const workspacePath = pathJoin(rawDir, entry)

        const stat = await readdir(workspacePath)

        // Create workspace output directory
        const wsOutputDir = pathJoin(outputDir, entry)

        await mkdir(wsOutputDir, { recursive: true })

        for (const file of stat) {
          if (!file.endsWith('.json')) continue

          try {

            const content = await readFile(pathJoin(workspacePath, file), 'utf8')
            const session = JSON.parse(content) as RawCursorRawSession

            // Transform Cursor format to Claude format using workspace ID as hash
            const claudeFormatted = this.transformCursorToClaudeFormat(session, entry)

            // Normalize the session using shared transformer
            const normalized = normalizeClaudeSession(claudeFormatted, 'Cursor')

            // Write normalized session
            const outputFile = pathJoin(wsOutputDir, file)

            await writeFile(outputFile, JSON.stringify(normalized, null, 2))
            totalSessions++
            console.log(`    ✅ ${session.title}`)
          } catch (error) {
            console.warn(`⚠️  Failed to transform ${file}:`, error instanceof Error ? error.message : String(error))
          }
        }
      }

      console.log(`\n🎉 Cursor clean transformation complete! ${totalSessions} sessions saved to: ${outputDir}`)
      return true
    } catch (error) {
      console.error('❌ Error during transformation:', error)
      return false
    }
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Add filesystem paths from property value to path set
   *
   * Helper function for normalizing workspace paths from various property formats found
   * throughout Cursor session data. Handles both string and array values to accommodate
   * different workspace path representations (single workspace vs monorepo with multiple paths).
   *
   * Processing logic:
   * - Array values: Each element is checked and added individually if it's a string
   * - String values: Added directly to the set
   * - Other types: Ignored (no-op)
   *
   * The Set data structure automatically handles deduplication of paths. Used extensively
   * in workspace path extraction to accumulate paths from multiple sources (metadata,
   * top-level properties, tool results).
   *
   * @param value - Property value that may be a string path, array of string paths, or other type
   * @param paths - Set to accumulate parsed filesystem paths (modified in place)
   */
  private addPathsFromProperty(value: unknown, paths: Set<string>): void {
    if (Array.isArray(value)) {
      for (const p of value) {
        if (typeof p === 'string') paths.add(p)
      }
    } else if (typeof value === 'string') {
      paths.add(value)
    }
  }
  
  /**
   * Extract and transform tool results from Cursor bubble to tool_use content block
   *
   * Converts Cursor's toolResults structure into a tool_use content block format compatible
   * with the unified message format. Extracts tool name and ID, simplifies parameters and output
   * based on tool type (e.g., run_terminal_cmd, read_file, write_file, etc.) for cleaner output.
   * Returns null if no valid toolResults provided.
   *
   * @param toolResults - Cursor bubble's toolResults object with name, toolCallId, params, result
   * @returns CleanCursorToolUseBlock or null if toolResults is empty
   */
  private extractCursorToolResult(toolResults: CursorToolResult): CleanCursorToolUseBlock | null {
    if (!toolResults) return null

    const toolName = toolResults.name
    const toolId = toolResults.toolCallId

    const toolUse: CleanCursorToolUseBlock = {
      id: toolId,
      name: toolName,
      // eslint-disable-next-line camelcase
      tool_use_id: toolId,
      type: 'tool_use',
    }

    // Extract and simplify input parameters
    if (toolResults.params) {
      toolUse.input = this.simplifyToolInput(toolName, toolResults.params)
    }

    // Extract and simplify execution result
    if (toolResults.result) {
      toolUse.output = this.simplifyToolOutput(toolName, toolResults.result)
    }

    return toolUse
  }

  /**
   * Extract workspace paths from Cursor session metadata
   *
   * Checks session metadata for workspacePath property and adds it to the paths set.
   * Handles both string and array workspace paths using addPathsFromProperty helper.
   * No-op if metadata is missing or does not contain workspacePath.
   *
   * @param cursorSession - RawCursorRawSession object containing optional metadata
   * @param paths - Set to accumulate workspace paths
   */
  private extractPathsFromMetadata(cursorSession: RawCursorRawSession, paths: Set<string>): void {
    if (!cursorSession.metadata) {
      return
    }

    const {metadata} = cursorSession
    if (metadata.workspacePath) {
      this.addPathsFromProperty(metadata.workspacePath, paths)
    }
  }

  /**
   * Extract file system paths from tool output text using regex pattern matching
   *
   * Scans output text for filesystem paths matching pattern /[^\s]+ (slash-prefixed, non-whitespace).
   * Filters results to valid-looking paths: contain /, don't start with /tmp, longer than 5 chars.
   * Removes trailing files (e.g., /path/to/file.ext → /path/to) to extract directory paths.
   * Used for extracting workspace paths from terminal command outputs.
   *
   * @param output - Tool output text potentially containing filesystem paths
   * @param paths - Set to accumulate discovered workspace paths
   */
  private extractPathsFromToolOutput(output: string, paths: Set<string>): void {
    const pathMatches = output.match(/\/[^\s]+/g) || []
    for (const p of pathMatches) {
      // Only add valid-looking paths (start with /, contain common path separators)
      if (p.includes('/') && !p.startsWith('/tmp') && p.length > 5) {
        // Extract directory path (remove trailing file if it looks like a file)
        const dirPath = p.replace(/\/[^/]*\.[a-z]+$/, '') || p
        if (dirPath !== '/') {
          paths.add(dirPath)
        }
      }
    }
  }

  /**
   * Extract workspace paths from tool results in all bubbles
   *
   * Iterates through all bubbles in the session, checking for toolResults with output/content.
   * Extracts paths from tool result text using extractPathsFromToolOutput which parses
   * filesystem paths from tool execution results (common in run_terminal_cmd results).
   * Used to discover workspace paths from command execution outputs.
   *
   * @param cursorSession - RawCursorRawSession object containing bubbles array
   * @param paths - Set to accumulate discovered workspace paths
   */
  private extractPathsFromToolResults(cursorSession: RawCursorRawSession, paths: Set<string>): void {
    for (const bubble of cursorSession.bubbles) {
      if (!bubble.toolResults) {
        continue
      }

      const {toolResults} = bubble
      // Parse tool result output for file paths (common in run_terminal_cmd)
      const output = typeof toolResults.output === 'string'
        ? toolResults.output
        : typeof toolResults.content === 'string'
        ? toolResults.content
        : ''
      this.extractPathsFromToolOutput(output, paths)
    }
  }

  /**
   * Extract all workspace paths from Cursor session data
   *
   * Collects workspace paths from multiple sources: top-level workspacePath property,
   * session metadata workspacePath, and filesystem paths extracted from tool result outputs.
   * Deduplicates paths and returns a sorted array. Provides comprehensive path discovery
   * from various locations where Cursor stores workspace information.
   *
   * @param cursorSession - RawCursorRawSession object with workspacePath, metadata, and bubbles
   * @returns Sorted array of unique workspace paths discovered
   */
  private extractWorkspacePathsFromCursor(cursorSession: RawCursorRawSession): string[] {
    const paths = new Set<string>()

    // Check if raw parser already extracted workspace paths
    if (cursorSession.workspacePath) {
      this.addPathsFromProperty(cursorSession.workspacePath, paths)
    }

    // Extract from metadata if available
    this.extractPathsFromMetadata(cursorSession, paths)

    // Extract from tool command results in bubbles
    this.extractPathsFromToolResults(cursorSession, paths)

    return [...paths].sort()
  }

  /**
   * Simplify tool input parameters based on tool type
   *
   * Filters tool input parameters to keep only essential fields for each tool type,
   * removing verbose metadata and unnecessary properties. Handles common Cursor tools:
   * codebase_search, create_folder, delete_file, delete_folder, read_file, run_terminal_cmd, write_file.
   * Returns complete params for unknown tools. Produces cleaner, more focused tool invocation records.
   *
   * @param toolName - Name of the tool (determines which parameters to keep)
   * @param params - Full parameter object from Cursor tool invocation
   * @returns Filtered parameter object with only essential fields for the tool type
   */
  private simplifyToolInput(toolName: string, params: Record<string, unknown>): Record<string, unknown> {
    if (!params) return {}

    switch (toolName) {
      case 'codebase_search': {
        // Keep only the query, move codeResults to output
        return {
          query: params.query,
        }
      }

      case 'create_folder': {
        // Keep only the folder path
        return {
          targetFolder: params.targetFolder,
        }
      }

      case 'delete_file':
      // eslint-disable-next-line no-fallthrough
      case 'delete_folder': {
        // Keep only the path
        return {
          targetPath: params.targetPath,
        }
      }

      case 'read_file': {
        // Keep only the target file path
        return {
          targetFile: params.targetFile,
        }
      }

      case 'run_terminal_cmd': {
        // Keep only the command
        return {
          command: params.command,
        }
      }

      case 'write_file': {
        // Keep file path and content
        return {
          content: params.content,
          targetFile: params.targetFile,
        }
      }

      default: {
        // Return all params for unknown tools
        return params
      }
    }
  }

  /**
   * Simplify tool output based on tool type
   *
   * Extracts essential content from verbose Cursor tool result structures, removing
   * redundant metadata while preserving actionable information. Handles common tools:
   * codebase_search (search results), file operations (success/message), read_file (contents),
   * run_terminal_cmd (output), and others. Returns tool_result wrapper with simplified content.
   * Returns undefined if result is empty.
   *
   * @param toolName - Name of the tool (determines which output fields to extract)
   * @param result - Full result object from Cursor tool execution
   * @returns CleanCursorToolResultBlock with simplified content or undefined if empty
   */
  private simplifyToolOutput(toolName: string, result: Record<string, unknown>): CleanCursorToolResultBlock | undefined {
    if (!result) return undefined

    switch (toolName) {
      case 'codebase_search': {
        // Keep the search results
        return {
          content: (result.codeResults as Record<string, unknown>) || result,
          type: 'tool_result',
        }
      }

      case 'create_folder':
      // eslint-disable-next-line no-fallthrough
      case 'delete_file':
      // eslint-disable-next-line no-fallthrough
      case 'delete_folder':
      case 'write_file': {
        // For file operations, keep simple confirmation
        const message = (result.message as string) || ((result.content as Record<string, unknown>)?.message as string) || ''
        const success = result.success !== false
        return {
          content: { message, success } as Record<string, unknown>,
          type: 'tool_result',
        }
      }

      case 'read_file': {
        // Return the file contents as a string instead of wrapped object
        const contents = (result.contents as string) || ((result.content as Record<string, unknown>)?.contents as string) || ''
        return {
          content: contents,
          type: 'tool_result',
        }
      }

      case 'run_terminal_cmd': {
        // Extract only the command output
        const output = (result.output as string) || ((result.content as Record<string, unknown>)?.output as string) || ''
        return {
          content: { output } as Record<string, unknown>,
          type: 'tool_result',
        }
      }

      default: {
        // Default wrapper for unknown tools
        return {
          content: result,
          type: 'tool_result',
        }
      }
    }
  }

  /**
   * Transform a single Cursor bubble into a Claude-format message
   *
   * Converts Cursor's bubble structure (a turn in conversation) to Claude message format.
   * Maps: ai → assistant message (text → thinking block), user → user message (text → text block).
   * Extracts and includes tool results, code blocks, and timestamp. Returns message with
   * content array (may be empty thinking block if no content).
   *
   * @param bubble - CursorBubble object with type, text, toolResults, codeBlocks, timestamp
   * @returns Message object with type, content array, and ISO timestamp
   */
  private transformCursorBubbleToClaudeMessage(bubble: CursorBubble): Record<string, unknown> {
    const messageType = bubble.type === 'ai' ? 'assistant' : 'user'
    const content: Array<Record<string, unknown>> = []

    // Add main text content
    // For assistant messages: convert to thinking block
    // For user messages: keep as text block
    if (bubble.text) {
      if (messageType === 'assistant') {
        content.push({
          thinking: bubble.text,
          type: 'thinking',
        })
      } else {
        content.push({
          text: bubble.text,
          type: 'text',
        })
      }
    }

    // Add tool results as tool_use blocks
    if (bubble.toolResults) {
      const toolBlock = this.extractCursorToolResult(bubble.toolResults)
      if (toolBlock) {
        content.push(toolBlock)
      }
    }

    // Add code blocks as text blocks with language info
    if (bubble.codeBlocks) {
      for (const codeBlock of bubble.codeBlocks) {
        if (codeBlock.content) {
          const languageId = codeBlock.languageId || ''
          content.push({
            text: `\`\`\`${languageId}\n${codeBlock.content}\n\`\`\``,
            type: 'text',
          })
        }
      }
    }

    const {timestamp} = bubble

    return {
      content: content.length > 0 ? content : [{ thinking: '', type: 'thinking' }],
      timestamp: new Date(timestamp).toISOString(),
      type: messageType,
    }
  }

  /**
   * Transform complete Cursor session to Claude-compatible format
   *
   * Converts all bubbles in a Cursor session to Claude messages, extracting workspace paths
   * from multiple sources (direct property, metadata, tool outputs). Produces normalized
   * session object with messages array, workspace paths, and preserved metadata/timestamps.
   *
   * @param cursorSession - RawCursorRawSession object with bubbles array and metadata
   * @param workspaceHash - Workspace identifier hash to include in output
   * @returns Session object in Claude format with messages and workspace information
   */
  private transformCursorToClaudeFormat(cursorSession: RawCursorRawSession, workspaceHash: string): Record<string, unknown> {
    const {bubbles} = cursorSession
    const messages = bubbles.map((bubble) =>
      this.transformCursorBubbleToClaudeMessage(bubble)
    )

    // Extract workspace paths - check raw parser first, then fallback to extraction
    const workspacePaths = this.extractWorkspacePathsFromCursor(cursorSession)
    return {
      id: cursorSession.id,
      messages,
      metadata: cursorSession.metadata,
      timestamp: cursorSession.timestamp,
      title: cursorSession.title,
      workspaceHash,
      workspacePaths: workspacePaths.length > 0 ? workspacePaths : undefined,
    }
  }
}

