/**
 * Codex Raw Service
 * Consolidates CodexParser + CodexRawParser
 * Parses JSONL transcript files from ~/.codex/sessions/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path, { join } from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import {
  ContentBlock,
  RawCodexContentBlock,
  RawCodexEventPayload,
  RawCodexRawEntry,
  RawCodexRawMessage,
  RawCodexRawSession,
  RawCodexResponsePayload,
  RawCodexSessionMeta,
  RawCodexSessionMetadata,
  RawCodexSessionMetaPayload,
  RawCodexTokenUsage,
  RawCodexTranscriptEntry,
} from '../../../core/domain/entities/parser.js'
import { IRawParserService } from '../../../core/interfaces/parser/i-raw-parser-service.js'

// ============================================================================
// CONSTANTS
// ============================================================================

const TITLE_MAX_LENGTH = 100
const SUMMARY_TEXT_TYPE = 'summary_text'

/**
 * Codex Raw Service
 * Handles extraction of Codex sessions from JSONL transcript files
 */
export class CodexRawService implements IRawParserService {
  private ide: Agent

  /**
   * Initialize Codex Raw Service
   *
   * @param ide - The IDE type (Codex)
   */
  constructor(ide: Agent) {
    this.ide = ide
  }

  /**
   * Main entry point - Parse Codex sessions from a custom directory
   *
   * Parses all JSONL transcript files from a Codex sessions directory,
   * extracts session information, and writes normalized JSON files to output directory.
   * Organizes output by date (YYYY-MM-DD) matching Codex's original directory structure.
   * Returns success status.
   *
   * @param customDir - Path to directory containing Codex session files
   * @returns Promise resolving to true if parsing succeeded, false otherwise
   */
  async parse(customDir: string): Promise<boolean> {
    const outputDir = path.join(process.cwd(), `.brv/logs/${this.ide}/raw`)

    console.log('🔍 Starting Codex conversation parsing...')
    console.log(`📁 Custom directory: ${customDir}`)

    try {
      // Parse all sessions from the Codex directory
      const sessions = await this.parseSessionDirectory(customDir)

      if (sessions.length === 0) {
        console.log('ℹ️  No Codex sessions found')
        return true
      }

      console.log(`\n✅ Found ${sessions.length} Codex sessions`)

      // Organize sessions by date (YYYY-MM-DD), matching Codex's original directory structure
      const sessionsByDate: Record<
        string,
        Array<typeof sessions[0] & { datePrefix: string }>
      > = {}

      for (const session of sessions) {
        // Extract date from session's startedAt timestamp
        const date = new Date(session.metadata.startedAt)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const datePrefix = `${year}-${month}-${day}`

        if (!sessionsByDate[datePrefix]) {
          sessionsByDate[datePrefix] = []
        }

        sessionsByDate[datePrefix].push({
          ...session,
          datePrefix,
        })
      }

      console.log(`\n📁 Organized into ${Object.keys(sessionsByDate).length} date(s)`)

      // Export sessions organized by date
      console.log('\n💾 Exporting sessions by date...')

      for (const [datePrefix, dateSessions] of Object.entries(sessionsByDate).sort()) {
        const dateDir = path.join(outputDir, datePrefix)
        if (!existsSync(dateDir)) {
          mkdirSync(dateDir, { recursive: true })
        }

        console.log(`\n  📅 ${datePrefix}`)

        // Export session files for this date
        for (const session of dateSessions) {
          const filename = `${session.id}.json`
          const filepath = path.join(dateDir, filename)

          writeFileSync(filepath, JSON.stringify(session, null, 2))
          const fileSize = readFileSync(filepath).length
          const fileSizeKb = (fileSize / 1024).toFixed(1)
          const truncatedTitle = session.title.slice(0, 50)
          console.log(
            `    ✅ ${truncatedTitle}${session.title.length > 50 ? '...' : ''} (${fileSizeKb} KB)`
          )
        }
      }

      console.log(`\n🎉 Codex export complete! Sessions exported to: ${outputDir}`)
      return true
    } catch (error) {
      console.error('❌ Error during parsing:', error)
      throw error
    }
  }


  /**
   * Build token usage object with optional cache tokens
   *
   * Constructs a token usage metrics object, including cache tokens only if they're
   * greater than zero. Calculates total tokens as sum of input and output.
   *
   * @param cacheTokens - Number of cached input tokens
   * @param inputTokens - Number of input tokens used
   * @param outputTokens - Number of output tokens generated
   * @returns Token usage object with optional cacheTokens and calculated total
   */
  private buildTokenUsageObject(
    cacheTokens: number,
    inputTokens: number,
    outputTokens: number
  ): {
    cacheTokens: number | undefined
    inputTokens: number
    outputTokens: number
    totalTokens: number
  } {
    return {
      cacheTokens: cacheTokens > 0 ? cacheTokens : undefined,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }
  }

  /**
   * Calculate aggregate session metadata from transcript entries
   *
   * Aggregates token usage, counts message types, extracts timestamps and workspace information.
   * Returns comprehensive metadata including token costs, message counts, duration, and session details.
   *
   * @param entries - Array of transcript entries from JSONL file
   * @param messages - Parsed messages array (for count verification)
   * @param logPath - Log file path (used to extract workspace information)
   * @param sessionMeta - Extracted session metadata (may be null)
   * @returns RawCodexSessionMetadata object with aggregated statistics
   */
  private calculateMetadata(
    entries: RawCodexTranscriptEntry[],
    messages: RawCodexRawMessage[],
    logPath: string,
    sessionMeta: null | RawCodexSessionMeta
  ): RawCodexSessionMetadata {
    const { cacheTokens, inputTokens, outputTokens } = this.calculateTokenUsage(entries)
    const { assistantCount, userCount } = this.countMessageTypes(messages)
    const { endedAt, startedAt } = this.extractTimestamps(entries, sessionMeta)
    const duration = new Date(endedAt || new Date()).getTime() - new Date(startedAt).getTime()

    return {
      assistantMessageCount: assistantCount,
      cliVersion: sessionMeta?.cli_version,
      duration,
      endedAt,
      messageCount: messages.length,
      model: sessionMeta?.model_provider || 'unknown',
      modelProvider: sessionMeta?.model_provider,
      originator: sessionMeta?.originator,
      sessionId: this.extractSessionId(logPath),
      source: sessionMeta?.source,
      startedAt,
      tokenUsage: this.buildTokenUsageObject(cacheTokens, inputTokens, outputTokens),
      userMessageCount: userCount,
      workspace: this.extractWorkspace(logPath, sessionMeta),
    }
  }

  /**
   * Calculate total token usage from transcript entries
   *
   * Aggregates token counts from all token_count event messages in the transcript.
   * Includes input tokens, output tokens, and cached input tokens.
   *
   * @param entries - Array of transcript entries to analyze
   * @returns Object with aggregated cacheTokens, inputTokens, and outputTokens
   */
  private calculateTokenUsage(entries: RawCodexTranscriptEntry[]): {
    cacheTokens: number
    inputTokens: number
    outputTokens: number
  } {
    let inputTokens = 0
    let outputTokens = 0
    let cacheTokens = 0

    for (const entry of entries) {
      if (!this.isTokenCountEntry(entry)) {
        continue
      }

      const usage = (entry.payload as Record<string, unknown>)?.info as Record<string, unknown> | undefined
      if (usage?.total_token_usage) {
        const tokenUsage = usage.total_token_usage as Record<string, unknown> | undefined
        inputTokens += typeof tokenUsage?.input_tokens === 'number' ? tokenUsage.input_tokens : 0
        outputTokens += typeof tokenUsage?.output_tokens === 'number' ? tokenUsage.output_tokens : 0
        cacheTokens += typeof tokenUsage?.cached_input_tokens === 'number' ? tokenUsage.cached_input_tokens : 0
      }
    }

    return { cacheTokens, inputTokens, outputTokens }
  }

  /**
   * Convert Codex content block to normalized content block
   *
   * Transforms a Codex-specific content block into a standardized ContentBlock format.
   * Handles tool_use blocks (preserves id, input, name) and text blocks (normalizes types).
   * Converts input_text type to text type for consistency.
   *
   * @param block - Codex content block to convert
   * @returns Normalized ContentBlock object
   */
  private convertCodexContentBlockToContentBlock(block: RawCodexContentBlock): ContentBlock {
    const contentBlock: Record<string, unknown> = {}

    if (block.type === 'tool_use') {
      contentBlock.id = `tool_${Date.now()}`
      if (block.input) contentBlock.input = block.input
      if (block.name) contentBlock.name = block.name
    } else if (block.text) {
      contentBlock.text = block.text
    }

    contentBlock.type = block.type === 'input_text' ? 'text' : block.type

    return contentBlock as ContentBlock
  }

  /**
   * Convert Codex transcript entries to normalized messages
   *
   * Transforms raw JSONL transcript entries (messages, function calls, reasoning, token counts) into
   * standardized RawCodexRawMessage objects. Tracks token usage and reasoning context across entries,
   * maintaining order and relationships between tool calls and responses.
   *
   * @param entries - Array of transcript entries from JSONL file
   * @returns Array of normalized RawCodexRawMessage objects
   */
  private convertToMessages(entries: RawCodexTranscriptEntry[]): RawCodexRawMessage[] {
    const messages: RawCodexRawMessage[] = []
    let currentTokenUsage: null | RawCodexTokenUsage = null
    let currentReasoning: null | string = null

    for (const entry of entries) {
      // Track token usage and reasoning from event messages
      if (entry.type === 'event_msg' && entry.payload && this.isEventPayload(entry.payload)) {
        if (entry.payload.type === 'token_count' && entry.payload.info) {
          currentTokenUsage = entry.payload.info.total_token_usage
        }

        if (entry.payload.type === 'agent_reasoning' && entry.payload.text) {
          currentReasoning = entry.payload.text
        }
      }

      // Process response items (messages, reasoning, function calls)
      if (entry.type === 'response_item' && entry.payload && this.isResponsePayload(entry.payload)) {
        const { payload } = entry
        const timestamp = entry.timestamp || new Date().toISOString()

        switch (payload.type) {
          case 'function_call': {
            this.processFunctionCall(payload, messages)
            break
          }

          case 'function_call_output': {
            this.processFunctionCallOutput(payload, messages)
            break
          }

          case 'message': {
            this.processMessage(payload, messages, timestamp, currentTokenUsage, currentReasoning)
            // Reset reasoning after message
            currentReasoning = null
            break
          }

          case 'reasoning': {
            const newReasoning = this.processReasoningPayload(payload)
            if (newReasoning) {
              currentReasoning = newReasoning
            }

            break
          }
          // No default
        }
      }
    }

    return messages
  }

  /**
   * Convert transcript entry to raw entry format
   *
   * Transforms a transcript entry into the raw entry storage format, filtering entries without payloads
   * and converting ISO timestamp strings to millisecond timestamps. Validates entry types and applies
   * fallback type for invalid entries.
   *
   * @param entry - Transcript entry to convert
   * @returns Converted RawCodexRawEntry object, or null if entry has no payload
   */
  private convertTranscriptEntryToRawEntry(entry: RawCodexTranscriptEntry): null | RawCodexRawEntry {
    // Filter entries that don't have a payload
    if (!entry.payload) {
      return null
    }

    // Convert timestamp from string to number
    const timestamp: number = entry.timestamp
      ? new Date(entry.timestamp).getTime()
      : Date.now()

    return {
      payload: entry.payload,
      timestamp,
      type: (entry.type === 'event_msg' || entry.type === 'response_item' || entry.type === 'session_meta' || entry.type === 'turn_context')
        ? entry.type
        : 'response_item', // Default fallback
    }
  }

  /**
   * Count user and assistant messages in a message array
   *
   * Iterates through messages and counts the total number of user and assistant messages.
   * Used for metadata tracking and session statistics.
   *
   * @param messages - Array of messages to count
   * @returns Object with assistantCount and userCount totals
   */
  private countMessageTypes(messages: RawCodexRawMessage[]): {
    assistantCount: number
    userCount: number
  } {
    let userCount = 0
    let assistantCount = 0

    for (const message of messages) {
      if (message.type === 'user') userCount++
      if (message.type === 'assistant') assistantCount++
    }

    return { assistantCount, userCount }
  }
   
  /**
   * Extract and normalize content blocks from message content
   *
   * Handles multiple content formats: null/undefined (empty array), strings (wrapped as text block),
   * arrays of blocks/strings (normalized to RawCodexContentBlock array), and objects.
   * Produces consistent RawCodexContentBlock array output for consistent processing.
   *
   * @param content - Raw message content in various formats
   * @returns Array of normalized RawCodexContentBlock objects
   */
  private extractContentBlocks(content: unknown): RawCodexContentBlock[] {
    const blocks: RawCodexContentBlock[] = []

    // If content is a string, wrap it as a text block
    if (typeof content === 'string') {
      return [{ text: content, type: 'output_text' }]
    }

    // If content is already an array of blocks
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string') {
          blocks.push({ text: block, type: 'output_text' })
        } else if (block && typeof block === 'object') {
          // Check if it's a valid block with a type field
          if ('type' in block) {
            blocks.push(block as RawCodexContentBlock)
          } else {
            // Fallback: wrap as text
            blocks.push({ text: JSON.stringify(block), type: 'output_text' })
          }
        }
      }

      return blocks
    }

    return [{ text: JSON.stringify(content), type: 'output_text' }]
  }

  /**
   * Extract session ID from Codex log file path
   *
   * Parses the filename from the log path to extract the session ID.
   * Codex session IDs are typically UUIDs in the JSONL filename.
   * Removes the .jsonl extension to get the session ID.
   *
   * @param logPath - Path to Codex session log file
   * @returns Session ID extracted from the filename
   */
  private extractSessionId(logPath: string): string {
    // Codex session IDs are typically UUIDs in the filename
    // Format: ~/.codex/sessions/YYYY/MM/DD/{session-id}.jsonl
    const parts = logPath.split('/')
    const filename = parts.at(-1) || ''
    return filename.replace('.jsonl', '')
  }

  /**
   * Extract session metadata from transcript entries
   *
   * Searches transcript entries for session_meta type entries and validates them.
   * Returns the session metadata payload (containing model, CLI version, timestamp, git info).
   * Returns null if no valid session metadata is found.
   *
   * @param entries - Array of transcript entries to search
   * @returns Extracted RawCodexSessionMeta payload, or null if not found
   */
  private extractSessionMeta(entries: RawCodexTranscriptEntry[]): null | RawCodexSessionMeta {
    const sessionMetaEntry = entries.find((e) => e.type === 'session_meta')
    if (sessionMetaEntry && sessionMetaEntry.payload && this.isSessionMetaPayload(sessionMetaEntry.payload)) {
      return sessionMetaEntry.payload
    }

    return null
  }

  /**
   * Extract session start and end timestamps
   *
   * Collects timestamps from transcript entries, filters empty values, sorts chronologically.
   * Prefers session metadata timestamp for start time if available, otherwise uses first entry timestamp.
   * Returns last timestamp as end time, or undefined if only one timestamp exists.
   *
   * @param entries - Array of transcript entries with optional timestamp fields
   * @param sessionMeta - Optional session metadata containing preferred start timestamp
   * @returns Object with startedAt and optional endedAt ISO timestamp strings
   */
  private extractTimestamps(
    entries: RawCodexTranscriptEntry[],
    sessionMeta: null | RawCodexSessionMeta
  ): { endedAt?: string; startedAt: string; } {
    const validTimestamps = entries
      .filter((e) => e.timestamp)
      .map((e) => e.timestamp || '')
      .filter((t) => t.trim().length > 0)
      .sort()

    return {
      endedAt: validTimestamps.at(-1),
      startedAt: sessionMeta?.timestamp || validTimestamps[0] || new Date().toISOString(),
    }
  }

  /**
   * Extract session title from first user message
   *
   * Uses the first line of the first user message as the session title.
   * Handles both string and array content formats, extracting text blocks from arrays.
   * Truncates to TITLE_MAX_LENGTH (100 chars) and appends "..." if truncated.
   * Returns default title if no user messages found or first message is empty.
   *
   * @param messages - Array of parsed session messages
   * @returns Session title string (max 100 characters)
   */
  private extractTitle(messages: RawCodexRawMessage[]): string {
    // Use first user message as title
    const firstUserMessage = messages.find((m) => m.type === 'user')
    if (firstUserMessage) {
      let text = ''

      if (typeof firstUserMessage.content === 'string') {
        text = firstUserMessage.content
      } else if (Array.isArray(firstUserMessage.content)) {
        const textBlocks = firstUserMessage.content.filter(
          (b): b is Record<string, string> => typeof b === 'object' && b !== null && 'text' in b && typeof b.text === 'string'
        )
        text = textBlocks.map((b: Record<string, string>) => b.text).join(' ')
      }

      if (text) {
        const lines = text.split('\n').filter((l) => l.trim())
        if (lines.length > 0) {
          const title = lines[0].slice(0, Math.max(0, TITLE_MAX_LENGTH))
          return title.length === TITLE_MAX_LENGTH ? title + '...' : title
        }
      }
    }

    return 'Codex Session'
  }

  /**
   * Extract workspace information from session metadata and log path
   *
   * Extracts workspace path and repository information from session metadata (preferred)
   * or falls back to log path if metadata is unavailable. Includes repository name and
   * optional git URL if available in session metadata.
   *
   * @param logPath - Codex session log file path (used as fallback)
   * @param sessionMeta - Optional session metadata containing workspace and git info
   * @returns Object with workspace path and optional repository name/url
   */
  private extractWorkspace(
    logPath: string,
    sessionMeta: null | RawCodexSessionMeta
  ): { path: string; repository?: { name: string; url?: string } } {
    // Try to get from session metadata first
    if (sessionMeta?.cwd) {
      const parts = sessionMeta.cwd.split('/')
      const name = parts.at(-1) || 'unknown'

      return {
        path: sessionMeta.cwd,
        repository: {
          name,
          url: sessionMeta.git?.repository_url,
        },
      }
    }

    // Fallback: use log path
    return {
      path: logPath,
    }
  }

  /**
   * Type guard for event payload
   *
   * Checks if a payload is a valid RawCodexEventPayload by verifying it's an object
   * with a type field matching token_count or agent_reasoning event types.
   *
   * @param payload - Value to check
   * @returns True if payload is a valid RawCodexEventPayload, false otherwise
   */
  private isEventPayload(payload: unknown): payload is RawCodexEventPayload {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      (payload.type === 'token_count' || payload.type === 'agent_reasoning')
    )
  }

  /**
   * Type guard for response payload
   *
   * Checks if a payload is a valid RawCodexResponsePayload by verifying it's an object
   * with a type field matching one of: function_call, function_call_output, message, or reasoning.
   *
   * @param payload - Value to check
   * @returns True if payload is a valid RawCodexResponsePayload, false otherwise
   */
  private isResponsePayload(payload: unknown): payload is RawCodexResponsePayload {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      ['function_call', 'function_call_output', 'message', 'reasoning'].includes(
        payload.type as string
      )
    )
  }

  /**
   * Type guard for session meta payload
   *
   * Checks if a payload is a valid RawCodexSessionMetaPayload by verifying it's an object
   * containing at least one of: model_provider, cli_version, or timestamp fields.
   *
   * @param payload - Value to check
   * @returns True if payload is a valid RawCodexSessionMetaPayload, false otherwise
   */
  private isSessionMetaPayload(payload: unknown): payload is RawCodexSessionMetaPayload {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      ('model_provider' in payload || 'cli_version' in payload || 'timestamp' in payload)
    )
  }

  /**
   * Check if entry is a token count event
   *
   * Validates that an entry is an event_msg type with an event payload of type 'token_count'
   * and contains token usage information (info field).
   *
   * @param entry - Transcript entry to check
   * @returns True if entry is a valid token count event, false otherwise
   */
  private isTokenCountEntry(entry: RawCodexTranscriptEntry): boolean {
    if (entry.type !== 'event_msg' || !entry.payload || !this.isEventPayload(entry.payload)) {
      return false
    }

    const payload = entry.payload as Record<string, unknown>
    return payload.type === 'token_count' && payload.info !== undefined
  }

  /**
   * Parse all Codex session logs in a directory
   *
   * Finds all JSONL files in the directory (including subdirectories), parses them in sequence,
   * and returns array of successfully parsed sessions sorted by start time.
   * Collects and reports any parse errors without failing completely.
   *
   * @param dirPath - Path to directory containing JSONL session files
   * @returns Promise resolving to array of parsed RawCodexRawSession objects
   * @throws Error if directory cannot be read
   */
  /* eslint-disable no-await-in-loop */
  private async parseSessionDirectory(dirPath: string): Promise<RawCodexRawSession[]> {
    try {
      const files = await readdir(dirPath, { recursive: true })
      const jsonlFiles = files.filter(
        (f) => typeof f === 'string' && f.endsWith('.jsonl') && !f.includes('-combined')
      )

      const sessions: RawCodexRawSession[] = []
      const errors: string[] = []

      for (const file of jsonlFiles) {
        try {
          const fullPath = join(dirPath, file as string)
          const session = await this.parseSessionLog(fullPath)
          sessions.push(session)
        } catch (error) {
          errors.push(`${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      if (sessions.length === 0 && errors.length > 0) {
        console.warn(`Failed to parse some logs: ${errors.join(', ')}`)
      }

      // Sort by start time
      sessions.sort((a, b) => a.metadata.startedAt.localeCompare(b.metadata.startedAt))
      return sessions
    } catch (error) {
      throw new Error(
        `Failed to parse directory: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Parse a single Codex session log file
   *
   * Validates log file format, reads JSONL content, parses each line as a transcript entry,
   * converts entries to messages, extracts session metadata, calculates aggregated statistics,
   * and extracts session title. Handles token usage, function calls, and reasoning payloads.
   *
   * @param logPath - Absolute path to Codex session JSONL file
   * @returns Promise resolving to parsed RawCodexRawSession object
   * @throws Error if file is invalid or cannot be parsed
   */
  private async parseSessionLog(logPath: string): Promise<RawCodexRawSession> {
    try {
      // Validate first
      const valid = await this.validateLogFile(logPath)
      if (!valid) {
        throw new Error(`Invalid Codex log path: ${logPath}`)
      }

      // Read and parse JSONL file
      const content = await readFile(logPath, 'utf8')
      const lines = content.trim().split('\n').filter((l) => l.trim())

      const entries: RawCodexTranscriptEntry[] = []
      const parseErrors: string[] = []

      for (const [i, line] of lines.entries()) {
        try {
          const entry = JSON.parse(line)
          entries.push(entry as RawCodexTranscriptEntry)
        } catch (error) {
          parseErrors.push(`Line ${i + 1}: ${error instanceof Error ? error.message : 'Parse error'}`)
        }
      }

      if (entries.length === 0) {
        throw new Error(`No valid entries found in ${logPath}`)
      }

      // Extract session info
      const sessionId = this.extractSessionId(logPath)
      const sessionMeta = this.extractSessionMeta(entries)
      const messages = this.convertToMessages(entries)
      const metadata = this.calculateMetadata(entries, messages, logPath, sessionMeta)

      const title = this.extractTitle(messages)

      // Convert transcript entries to raw entries, filtering out entries without payloads
      const rawEntries: RawCodexRawEntry[] = entries
        .map((entry) => this.convertTranscriptEntryToRawEntry(entry))
        .filter((entry): entry is RawCodexRawEntry => entry !== null)

      return {
        id: sessionId,
        messages,
        metadata,
        rawEntries,
        timestamp: new Date(metadata.startedAt).getTime(),
        title,
      }
    } catch (error) {
      throw new Error(
        `Failed to parse Codex log: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Process function call payload and add to last message
   *
   * Extracts function call information from a function_call payload and appends it as a tool_use
   * content block to the last message. Converts string arguments to parsed objects.
   * If last message content is a string, converts it to an array before adding tool block.
   *
   * @param payload - Function call payload containing name, arguments, and call ID
   * @param messages - Messages array to update (modifies last message in place)
   */
  private processFunctionCall(payload: Record<string, unknown>, messages: RawCodexRawMessage[]): void {
    if (messages.length === 0) return

    const lastMessage = messages.at(-1)
    if (!lastMessage) return

    const toolBlock: Record<string, unknown> = {
      id: `call_${Date.now()}`,
      input:
        typeof payload.arguments === 'string'
          ? this.safeJsonParse(payload.arguments)
          : payload.arguments,
      name: payload.name || 'unknown',
      type: 'tool_use',
    }

    if (Array.isArray(lastMessage.content)) {
      lastMessage.content.push(toolBlock as ContentBlock)
    } else {
      // Convert string content to array and add tool block
      const textBlock: Record<string, unknown> = {
        text: lastMessage.content as string,
        type: 'output_text',
      }
      lastMessage.content = [textBlock as ContentBlock, toolBlock as ContentBlock]
    }
  }

  /**
   * Process function call output and attach to corresponding tool use block
   *
   * Finds the most recent tool_use block in the last message and appends the function output to it.
   * The output field contains the result of the function call execution.
   *
   * @param payload - Function call output payload containing output data
   * @param messages - Messages array to update (modifies last message in place)
   */
  private processFunctionCallOutput(payload: Record<string, unknown>, messages: RawCodexRawMessage[]): void {
    if (messages.length === 0) return

    const lastMessage = messages.at(-1)
    if (!lastMessage || !Array.isArray(lastMessage.content)) return

    // Find the tool use block with matching call_id
    const toolBlock = lastMessage.content.find(
      (b) => b.type === 'tool_use'
    ) as RawCodexContentBlock | undefined
    if (toolBlock) {
      toolBlock.output = payload.output
    }
  }

  /**
   * Process message payload and add to messages array
   *
   * Converts a message payload into a normalized RawCodexRawMessage and appends to messages array.
   * Handles content block conversion, attaches token usage and reasoning context if available.
   * Collapses single text blocks to strings for backward compatibility.
   *
   * @param payload - Message payload containing role and content
   * @param messages - Messages array to update (appends new message)
   * @param timestamp - ISO timestamp for the message
   * @param currentTokenUsage - Optional token usage metrics to attach to message
   * @param currentReasoning - Optional reasoning content to attach to message
   */
  // eslint-disable-next-line max-params
  private processMessage(
    payload: Record<string, unknown>,
    messages: RawCodexRawMessage[],
    timestamp: string,
    currentTokenUsage: null | RawCodexTokenUsage,
    currentReasoning: null | string
  ): void {
    const role = payload.role as 'assistant' | 'user'
    const codexContentBlocks = this.extractContentBlocks(payload.content)

    // Convert CodexContentBlock array to ContentBlock array
    const contentBlocks: ContentBlock[] = codexContentBlocks.map((block) => this.convertCodexContentBlockToContentBlock(block))

    messages.push({
      content:
        contentBlocks.length === 1 && contentBlocks[0].type === 'text'
          ? (contentBlocks[0] as Record<string, unknown>).text as string
          : contentBlocks.length === 1 && contentBlocks[0].type === 'output_text'
            ? (contentBlocks[0] as Record<string, unknown>).text as string
            : contentBlocks,
      reasoning: currentReasoning || undefined,
      timestamp,
      tokens: currentTokenUsage
        ? {
            input: currentTokenUsage.input_tokens || 0,
            output: currentTokenUsage.output_tokens || 0,
          }
        : undefined,
      type: role,
    })
  }

  /**
   * Process reasoning payload and extract reasoning text summary
   *
   * Extracts reasoning content from a reasoning payload by filtering summary items of type 'summary_text'
   * and joining their text content. Returns null if no valid reasoning content is found.
   *
   * @param payload - Reasoning payload containing summary array
   * @returns Extracted reasoning text or null if no valid content found
   */
  private processReasoningPayload(payload: Record<string, unknown>): null | string {
    if (!payload.summary || !Array.isArray(payload.summary)) return null

    const summaryTexts = payload.summary
      .filter((s: unknown): s is { text: string; type: string } => 'type' in (s as Record<string, unknown>) && (s as Record<string, unknown>).type === SUMMARY_TEXT_TYPE)
      .map((s: { text: string; type: string }) => s.text)

    return summaryTexts.length > 0 ? summaryTexts.join('\n') : null
  }

  /**
   * Safely parse JSON string or return object as-is
   *
   * Attempts to parse a JSON string. If input is already an object, returns it directly.
   * Returns empty object on parse errors or non-string/object inputs.
   * Used for defensive parsing of tool call arguments.
   *
   * @param jsonString - String to parse or object to validate
   * @returns Parsed object or empty object if parsing fails
   */
  private safeJsonParse(jsonString: unknown): Record<string, unknown> {
    if (typeof jsonString === 'object' && jsonString !== null) {
      return jsonString as Record<string, unknown>
    }

    if (typeof jsonString !== 'string') {
      return {}
    }

    try {
      const parsed = JSON.parse(jsonString)
      return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch {
      return {}
    }
  }


  /**
   * Validate Codex log file format and existence
   *
   * Checks three validation criteria:
   * 1. Path contains /.codex/sessions/ directory marker
   * 2. File has .jsonl extension
   * 3. File exists on filesystem
   * Returns false silently if any check fails.
   *
   * @param logPath - Path to file to validate
   * @returns Promise resolving to true if file is valid Codex log file, false otherwise
   */
  private async validateLogFile(logPath: string): Promise<boolean> {
    try {
      // Check path contains .codex/sessions/
      if (!logPath.includes('/.codex/sessions/')) {
        return false
      }

      // Check file extension is .jsonl
      if (!logPath.endsWith('.jsonl')) {
        return false
      }

      // Check file exists
      return existsSync(logPath)
    } catch {
      return false
    }
  }
}
