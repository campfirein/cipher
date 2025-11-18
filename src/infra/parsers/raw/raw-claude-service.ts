/**
 * Claude Code Raw Service
 * Consolidates ClaudeCodeParser + ClaudeRawParser
 * Parses JSONL transcript files from ~/.claude/projects/
 */

import { existsSync , mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path, { basename, join } from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import {
  ClaudeRawMessage,
  ClaudeRawSession,
  ClaudeSessionMetadata,
  ClaudeTranscriptEntry,
  ContentBlock,
  TextContentBlock,
} from '../../../core/domain/entities/parser.js'

/**
 * Constants
 */
const CLAUDE_PROJECTS_PATH = '/.claude/projects/'
const JSONL_FILE_EXTENSION = '.jsonl'
const COMBINED_FILE_SUFFIX = '-combined'
const FILE_SIZE_DECIMAL_PLACES = 1
const TITLE_MAX_LENGTH = 100

const MESSAGES = {
  CLAUDE_FOLDER_NAME: '📁 Claude folder name:',
  CUSTOM_DIRECTORY: '📁 Custom directory:',
  DEFAULT_SESSION_TITLE: 'Claude Code Session',
  ERROR_PARSING: '❌ Error during parsing:',
  EXPORT_COMPLETE: '🎉 Claude Code export complete! Sessions exported to:',
  EXPORTING: '💾 Exporting sessions...',
  FAILED_PARSE_DIR: 'Failed to parse directory:',
  FAILED_PARSE_LOG: 'Failed to parse Claude Code log:',
  INVALID_LOG_PATH: 'Invalid Claude Code log path:',
  NO_ENTRIES_FOUND: 'No valid entries found in',
  NO_SESSIONS: 'ℹ️  No Claude Code sessions found',
  PARSE_ERROR: 'Parse error',
  PARSING_START: '🔍 Starting Claude Code conversation parsing...',
  SESSION_EXPORTED: '✅',
  SESSIONS_FAILED: 'Failed to parse some logs:',
  SESSIONS_FOUND: 'Found',
  SYSTEM_MESSAGE: 'System message',
  UNKNOWN_ERROR: 'Unknown error',
  UNKNOWN_REPO: 'unknown',
} as const

/**
 * Claude Raw Service - Wraps parser and handles file I/O and output management
 */
export class ClaudeRawService {
  private ide: Agent

  /**
   * Initialize Claude Raw Service
   *
   * @param ide - The IDE type (Claude Code)
   */
  constructor(ide: Agent) {
    this.ide = ide
  }

  /**
   * Main entry point - Parse Claude Code sessions from a custom directory
   *
   * Parses all JSONL transcript files from a custom Claude projects directory,
   * extracts session information, and writes normalized JSON files to output directory.
   * Organizes output by Claude project folder name. Returns success status.
   *
   * @param customDir - Path to directory containing Claude Code session files
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  async parse(customDir: string): Promise<boolean> {
    const outputDir = this.getOutputDir(this.ide)

    console.log(MESSAGES.PARSING_START)
    console.log(`${MESSAGES.CUSTOM_DIRECTORY} ${customDir}`)

    // Extract Claude folder name from customDir
    // customDir is like: /Users/datpham/.claude/projects/-Users-datpham-dpmemories-byterover-cli
    // We want to use: -Users-datpham-dpmemories-byterover-cli as the project folder name
    const claudeFolderName = basename(customDir)
    console.log(`${MESSAGES.CLAUDE_FOLDER_NAME} ${claudeFolderName}`)

    // Create output directory
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    try {
      // Parse sessions from custom directory
      const sessions = await this.parseFromDirectory(customDir) as ClaudeRawSession[]

      if (sessions.length === 0) {
        console.log(MESSAGES.NO_SESSIONS)
        return true
      }

      console.log(`\n${MESSAGES.SESSION_EXPORTED} ${MESSAGES.SESSIONS_FOUND} ${sessions.length} sessions`)

      // Export sessions organized by Claude project folder name
      console.log(`\n${MESSAGES.EXPORTING}`)

      // Create project-specific directory using Claude folder name
      const projectDir = this.createSubdirectory(outputDir, claudeFolderName)

      for (const session of sessions) {
        const filename = `${session.id}.json`
        const filepath = path.join(projectDir, filename)

        writeFileSync(filepath, JSON.stringify(session, null, 2))
        const fileSize = readFileSync(filepath).length
        const fileSizeKb = (fileSize / 1024).toFixed(FILE_SIZE_DECIMAL_PLACES)
        console.log(`    ${MESSAGES.SESSION_EXPORTED} ${session.title} (${fileSizeKb} KB)`)
      }

      console.log(`\n${MESSAGES.EXPORT_COMPLETE} ${outputDir}`)
      return true
    } catch (error) {
      console.error(`${MESSAGES.ERROR_PARSING}`, error)
      throw error
    }
  }

  /**
   * Calculate aggregate session metadata from transcript entries
   *
   * Aggregates token usage (input, output, cache), counts message types, extracts workspace,
   * workspace path, and timestamps. Returns comprehensive metadata about the session including
   * duration, token costs, and message counts for analysis and reporting.
   *
   * @param entries - Array of transcript entries from JSONL file
   * @param messages - Parsed messages array (for count verification)
   * @param logPath - Log file path (used to extract workspace information)
   * @returns ClaudeSessionMetadata object with aggregated statistics
   */
  private calculateMetadata(
    entries: ClaudeTranscriptEntry[],
    messages: ClaudeRawMessage[],
    logPath: string
  ): ClaudeSessionMetadata {
    let inputTokens = 0
    let outputTokens = 0
    let cacheTokens = 0
    let userCount = 0
    let assistantCount = 0
    let cwd: string | undefined

    for (const entry of entries) {
      if (entry.message?.usage) {
        inputTokens += entry.message.usage.input_tokens || 0
        outputTokens += entry.message.usage.output_tokens || 0
        cacheTokens += entry.message.usage.cache_creation_input_tokens || 0
        cacheTokens += entry.message.usage.cache_read_input_tokens || 0
      }

      if (entry.type === 'user') userCount++
      if (entry.type === 'assistant') assistantCount++

      // Capture cwd from the first entry that has it
      if (!cwd && entry.cwd) {
        cwd = entry.cwd
      }
    }

    const { endedAt, startedAt } = this.extractTimestamps(entries)
    const duration = new Date(endedAt || new Date()).getTime() - new Date(startedAt).getTime()

    const metadata: ClaudeSessionMetadata = {
      assistantMessageCount: assistantCount,
      duration,
      endedAt,
      messageCount: messages.length,
      sessionId: this.extractSessionId(logPath),
      startedAt,
      tokenUsage: {
        cacheTokens: cacheTokens > 0 ? cacheTokens : undefined,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      userMessageCount: userCount,
      workspace: this.extractWorkspace(logPath),
    }

    // Only include cwd if it has a value
    if (cwd) {
      metadata.cwd = cwd
    }

    return metadata
  }

  /**
   * Convert Claude Code transcript entries to normalized messages
   *
   * Transforms raw JSONL transcript entries (user, assistant, system) into standardized
   * ClaudeRawMessage objects with preserved content, timestamps, and token counts.
   * Filters out invalid entries without content.
   *
   * @param entries - Array of ClaudeTranscriptEntry objects from JSONL file
   * @returns Array of normalized ClaudeRawMessage objects
   */
  private convertToMessages(entries: ClaudeTranscriptEntry[]): ClaudeRawMessage[] {
    const messages: ClaudeRawMessage[] = []

    for (const entry of entries) {
      if (entry.type === 'user' && entry.message) {
        messages.push(this.createMessageFromEntry(entry, 'user'))
      } else if (entry.type === 'assistant' && entry.message) {
        messages.push(this.createMessageFromEntry(entry, 'assistant'))
      } else if (entry.type === 'system') {
        messages.push(this.createSystemMessage(entry))
      }
    }

    return messages
  }

  /**
   * Create normalized message from transcript entry
   *
   * Converts a single transcript entry (user or assistant) into a normalized message.
   * Extracts content blocks, preserving array structure for multi-block content but
   * converting single text blocks to plain strings for backward compatibility.
   * Includes token counts if available and preserves cwd if present.
   *
   * @param entry - Transcript entry with message content
   * @param type - Message type: 'user' or 'assistant'
   * @returns Normalized ClaudeRawMessage object
   * @throws Error if message field is missing
   */
  private createMessageFromEntry(entry: ClaudeTranscriptEntry, type: 'assistant' | 'user'): ClaudeRawMessage {
    const { message } = entry
    if (!message) {
      throw new Error(`Message required for ${type} entry`)
    }

    // Preserve content as array of blocks instead of converting to string
    const contentBlocks = this.extractContentBlocks(message.content)
    const isSingleTextBlock = contentBlocks.length === 1 && contentBlocks[0].type === 'text' && 'text' in contentBlocks[0]

    const result: ClaudeRawMessage = {
      content: isSingleTextBlock
        ? (contentBlocks[0] as TextContentBlock).text
        : contentBlocks,
      timestamp: entry.timestamp || new Date().toISOString(),
      tokens: message.usage
        ? {
            input: message.usage.input_tokens || 0,
            output: message.usage.output_tokens || 0,
          }
        : undefined,
      type,
    }

    // Only include cwd if it has a value
    if (entry.cwd) {
      result.cwd = entry.cwd
    }

    return result
  }

  /**
   * Create or get subdirectory within output directory
   *
   * Creates a subdirectory within the output directory if it doesn't exist.
   * Uses recursive mode to create parent directories as needed.
   *
   * @param outputDir - Base output directory path
   * @param subdirName - Name of subdirectory to create
   * @returns Full path to the created or existing subdirectory
   */
  private createSubdirectory(outputDir: string, subdirName: string): string {
    const subdir = path.join(outputDir, subdirName)
    if (!existsSync(subdir)) {
      mkdirSync(subdir, { recursive: true })
    }

    return subdir
  }

  /**
   * Create system message from transcript entry
   *
   * Converts a system-type transcript entry into a normalized message object.
   * System messages typically contain metadata or initial instructions.
   * Preserves cwd if present in the entry.
   *
   * @param entry - Transcript entry with type='system'
   * @returns Normalized ClaudeRawMessage with type='system'
   */
  private createSystemMessage(entry: ClaudeTranscriptEntry): ClaudeRawMessage {
    const result: ClaudeRawMessage = {
      content: entry.content || MESSAGES.SYSTEM_MESSAGE,
      timestamp: entry.timestamp || new Date().toISOString(),
      type: 'system',
    }

    // Only include cwd if it has a value
    if (entry.cwd) {
      result.cwd = entry.cwd
    }

    return result
  }

  /**
   * Extract and normalize content blocks from message
   *
   * Handles multiple content formats: null/undefined (empty array), strings (wrapped as text block),
   * arrays of blocks/strings (normalized to ContentBlock array), objects with type (treated as block),
   * and other objects (stringified as text). Produces consistent ContentBlock array output.
   *
   * @param content - Raw message content in various formats
   * @returns Array of normalized ContentBlock objects
   */
  private extractContentBlocks(content: (ContentBlock | string)[] | null | Record<string, unknown> | string | undefined): ContentBlock[] {
    // If content is null or undefined, return empty array
    if (content === null || content === undefined) {
      return []
    }

    // If content is a string, wrap it as a text block
    if (typeof content === 'string') {
      return [{text: content, type: 'text'}]
    }

    // If content is already an array of blocks
    if (Array.isArray(content)) {
      const blocks: ContentBlock[] = []
      for (const block of content) {
        if (typeof block === 'string') {
          blocks.push({text: block, type: 'text'})
        } else if (block && typeof block === 'object' && 'type' in block) {
          // It's a valid block with a type field
          blocks.push(block as ContentBlock)
        } else if (block && typeof block === 'object') {
          // Fallback: wrap as text
          blocks.push({text: JSON.stringify(block), type: 'text'})
        }
      }

      return blocks
    }

    // If it's an object, try to handle it as a content block or stringify
    if (typeof content === 'object') {
      if ('type' in content) {
        return [content as ContentBlock]
      }

      return [{text: JSON.stringify(content), type: 'text'}]
    }

    // Fallback for any other type
    return [{text: String(content), type: 'text'}]
  }

  /**
   * Extract session ID from Claude Code log file path
   *
   * Parses the filename from the log path to extract the session ID.
   * Claude Code session IDs are typically UUIDs in the JSONL filename.
   * Removes the .jsonl extension to get the session ID.
   *
   * @param logPath - Path to Claude Code session log file
   * @returns Session ID extracted from the filename
   */
  private extractSessionId(logPath: string): string {
    // Claude Code session IDs are typically UUIDs in the filename
    // Format: ~/.claude/projects/-path-to-project/{session-id}.jsonl
    const parts = logPath.split('/')
    const filename = parts.at(-1) || ''
    return filename.replace(JSONL_FILE_EXTENSION, '')
  }

  /**
   * Extract and sort session start and end timestamps
   *
   * Collects timestamps from transcript entries, filters out empty values,
   * sorts them chronologically, and returns first (startedAt) and last (endedAt).
   * Returns default current timestamp if no valid timestamps found.
   *
   * @param entries - Array of transcript entries with optional timestamp fields
   * @returns Object with startedAt and optional endedAt ISO timestamp strings
   */
  private extractTimestamps(entries: ClaudeTranscriptEntry[]): { endedAt?: string; startedAt: string; } {
    const validTimestamps = entries
      .filter((e) => e.timestamp)
      .map((e) => e.timestamp || '')
      .filter((t) => t.trim().length > 0)
      .sort()

    return {
      endedAt: validTimestamps.at(-1),
      startedAt: validTimestamps[0] || new Date().toISOString(),
    }
  }

  /**
   * Extract session title from first user message
   *
   * Uses the first line of the first user message as the session title.
   * Truncates to TITLE_MAX_LENGTH (100 chars) and appends "..." if truncated.
   * Returns default title if no user messages found or first message is not text.
   *
   * @param messages - Array of parsed session messages
   * @returns Session title string (max 100 characters)
   */
  private extractTitle(messages: ClaudeRawMessage[]): string {
    // Use first user message as title
    const firstUserMessage = messages.find((m) => m.type === 'user')
    if (firstUserMessage && typeof firstUserMessage.content === 'string') {
      const text = firstUserMessage.content
      const lines = text.split('\n').filter((l: string) => l.trim())
      if (lines.length > 0) {
        const title = lines[0].slice(0, Math.max(0, TITLE_MAX_LENGTH))
        return title.length === TITLE_MAX_LENGTH ? title + '...' : title
      }
    }

    return MESSAGES.DEFAULT_SESSION_TITLE
  }

  /**
   * Extract workspace information from Claude Code log file path
   *
   * Parses the log path to extract workspace information. Claude Code stores projects
   * in ~/.claude/projects/-path-to-workspace format where slashes are replaced with dashes.
   * Extracts and reconstructs the original workspace path and repository name.
   * Returns default path object if extraction fails.
   *
   * @param logPath - Claude Code session log file path
   * @returns Object with workspace path and optional repository name/url
   */
  private extractWorkspace(
    logPath: string
  ): { path: string; repository?: { name: string; url?: string } } {
    // Claude Code stores projects in ~/.claude/projects/-path-to-workspace
    // Extract the workspace path from the CLAUDE_PROJECTS_PATH directory name
    try {
      const match = logPath.match(/\.claude\/projects\/(.*?)\//);
      if (match && match[1]) {
        // Convert -path-to-workspace back to /path/to/workspace
        const projectName = match[1]
        const workspacePath = projectName.startsWith('-')
          ? projectName.slice(1).replaceAll('-', '/')
          : projectName

        return {
          path: `/${workspacePath}`,
          repository: {
            name: workspacePath.split('/').pop() || MESSAGES.UNKNOWN_REPO,
          },
        }
      }
    } catch {
      // Fall through to default
    }

    return {
      path: logPath,
    }
  }

  /**
   * Get the output directory path for raw parser results
   *
   * Returns the standardized output directory path for storing raw parsed sessions.
   * Directory is relative to current working directory under .brv/logs/{ide}/raw
   *
   * @param ide - IDE agent type (used as directory component)
   * @returns Full path to raw output directory
   */
  private getOutputDir(ide: Agent): string {
    return path.join(process.cwd(), `.brv/logs/${ide}/raw`)
  }

  /**
   * Alias method - Parse sessions from a custom directory
   *
   * Convenience alias that delegates to parseSessionDirectory for parsing
   * all Claude Code session files in a directory.
   *
   * @param dirPath - Path to directory containing JSONL session files
   * @returns Promise resolving to array of parsed ClaudeRawSession objects
   */
  private async parseFromDirectory(dirPath: string): Promise<ClaudeRawSession[]> {
    return this.parseSessionDirectory(dirPath)
  }

  // ============================================================================
  // Private Metadata Helpers
  // ============================================================================

  /**
   * Parse all Claude Code session logs in a directory
   *
   * Finds all JSONL files in the directory (excluding combined files), parses them in parallel,
   * and returns array of successfully parsed sessions sorted by start time.
   * Collects and reports any parse errors without failing completely.
   *
   * @param dirPath - Path to directory containing JSONL session files
   * @returns Promise resolving to array of parsed ClaudeRawSession objects
   * @throws Error if directory cannot be read
   */
  private async parseSessionDirectory(dirPath: string): Promise<ClaudeRawSession[]> {
    try {
      const files = await readdir(dirPath, { recursive: false })
      const jsonlFiles = files.filter(
        (f) => typeof f === 'string' && f.endsWith(JSONL_FILE_EXTENSION) && !f.includes(COMBINED_FILE_SUFFIX)
      )

      const errors: string[] = []

      // Parse all files in parallel
      const parsePromises = jsonlFiles.map(async (file) => {
        try {
          const fullPath = join(dirPath, file as string)
          return await this.parseSessionLog(fullPath)
        } catch (error) {
          errors.push(`${file}: ${error instanceof Error ? error.message : MESSAGES.UNKNOWN_ERROR}`)
          return null
        }
      })

      const results = await Promise.all(parsePromises)
      const sessions = results.filter((session): session is ClaudeRawSession => session !== null)

      if (sessions.length === 0 && errors.length > 0) {
        console.warn(`${MESSAGES.SESSIONS_FAILED} ${errors.join(', ')}`)
      }

      // Sort by start time
      sessions.sort((a, b) => a.metadata.startedAt.localeCompare(b.metadata.startedAt))
      return sessions
    } catch (error) {
      throw new Error(
        `${MESSAGES.FAILED_PARSE_DIR} ${error instanceof Error ? error.message : MESSAGES.UNKNOWN_ERROR}`
      )
    }
  }

  /**
   * Parse a single Claude Code session log file
   *
   * Validates log file format, reads JSONL content, parses each line as a transcript entry,
   * converts entries to messages, calculates session metadata, and extracts session title.
   * Throws detailed error if log file is invalid or unparseable.
   *
   * @param logPath - Absolute path to Claude Code session JSONL file
   * @returns Promise resolving to parsed ClaudeRawSession object
   * @throws Error if file is invalid or cannot be parsed
   */
  private async parseSessionLog(logPath: string): Promise<ClaudeRawSession> {
    try {
      // Validate first
      const valid = await this.validateLogFile(logPath)
      if (!valid) {
        throw new Error(`${MESSAGES.INVALID_LOG_PATH} ${logPath}`)
      }

      // Read and parse JSONL file
      const content = await readFile(logPath, 'utf8')
      const lines = content.trim().split('\n').filter((l) => l.trim())

      const entries: ClaudeTranscriptEntry[] = []
      const parseErrors: string[] = []

      for (const [i, line] of lines.entries()) {
        try {
          const entry = JSON.parse(line)
          entries.push(entry as ClaudeTranscriptEntry)
        } catch (error) {
          parseErrors.push(`Line ${i + 1}: ${error instanceof Error ? error.message : MESSAGES.PARSE_ERROR}`)
        }
      }

      if (entries.length === 0) {
        throw new Error(`${MESSAGES.NO_ENTRIES_FOUND} ${logPath}`)
      }

      // Extract session info
      const sessionId = this.extractSessionId(logPath)
      const messages = this.convertToMessages(entries)
      const metadata = this.calculateMetadata(entries, messages, logPath)

      const title = this.extractTitle(messages)

      return {
        id: sessionId,
        messages,
        metadata,
        timestamp: new Date(metadata.startedAt).getTime(),
        title,
      }
    } catch (error) {
      throw new Error(
        `${MESSAGES.FAILED_PARSE_LOG} ${error instanceof Error ? error.message : MESSAGES.UNKNOWN_ERROR}`
      )
    }
  }

  /**
   * Validate Claude Code log file format and existence
   *
   * Checks three validation criteria:
   * 1. Path contains /.claude/projects/ directory marker
   * 2. File has .jsonl extension
   * 3. File exists on filesystem
   * Returns false silently if any check fails.
   *
   * @param logPath - Path to file to validate
   * @returns Promise resolving to true if file is valid Claude Code log file, false otherwise
   */
  private async validateLogFile(logPath: string): Promise<boolean> {
    try {
      // Check path contains CLAUDE_PROJECTS_PATH
      if (!logPath.includes(CLAUDE_PROJECTS_PATH)) {
        return false
      }

      // Check file extension is JSONL
      if (!logPath.endsWith(JSONL_FILE_EXTENSION)) {
        return false
      }

      // Check file exists
      return existsSync(logPath)
    } catch {
      return false
    }
  }
}