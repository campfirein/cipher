/**
 * Codex Clean Service
 * Transforms Codex raw parsed data to clean normalized format
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Agent } from '../../../core/domain/entities/agent.js'
import {
  CleanMessage,
  CodexRawEntry,
  ContentBlock,
  TextContentBlock,
  ThinkingContentBlock,
  ToolResultContentBlock,
  ToolUseContentBlock,
} from '../../../core/domain/entities/parser.js'
import { ICleanParserService } from '../../../core/interfaces/parser/i-clean-parser-service.js'
import {
  addTurnIds,
  combineToolResults,
} from './shared.js'

/**
 * Codex Clean Service
 * Transforms Codex raw parsed sessions to clean normalized format
 */
export class CodexCleanService implements ICleanParserService {
  private ide: Agent

  constructor(ide: Agent) {
    this.ide = ide
  }

  /**
   * Parse and transform Codex raw sessions to clean normalized format
   *
   * Reads Codex raw session files organized by date, transforms them to a unified
   * format, and writes the normalized sessions to the output directory. Each session
   * is processed using Codex-specific transformation logic.
   *
   * @param rawDir - Absolute path to the directory containing raw Codex session files organized by date
   * @returns Promise that resolves to true if parsing succeeded, false otherwise
   */
  /* eslint-disable no-await-in-loop */
  async parse(rawDir: string): Promise<boolean> {
    const outputDir = path.join(process.cwd(), `.brv/logs/${this.ide}/clean`)

    console.log('🔍 Starting Codex clean transformation...')
    console.log(`📁 Raw directory: ${rawDir}`)

    try {
      await mkdir(outputDir, { recursive: true })

      // Read raw sessions organized by date
      const dateDirs = await readdir(rawDir)

      let totalSessions = 0

      for (const dateDir of dateDirs) {
        const datePath = path.join(rawDir, dateDir)
        const stat = await readdir(datePath)

        // Create date output directory
        const dateOutputDir = path.join(outputDir, dateDir)
        await mkdir(dateOutputDir, { recursive: true })

        console.log(`\n  📅 ${dateDir}`)

        for (const file of stat) {
          if (!file.endsWith('.json')) continue

          try {
            const content = await readFile(path.join(datePath, file), 'utf8')
            const session = JSON.parse(content)

            // Normalize the session using Codex-specific transformer
            const normalized = this.normalizeCodexSession(session)

            // Write normalized session
            const outputFile = path.join(dateOutputDir, file)
            await writeFile(outputFile, JSON.stringify(normalized, null, 2))
            totalSessions++
            console.log(`    ✅ ${session.title}`)
          } catch (error) {
            console.warn(`⚠️  Failed to transform ${file}:`, error instanceof Error ? error.message : String(error))
          }
        }
      }

      console.log(`\n🎉 Codex clean transformation complete! ${totalSessions} sessions saved to: ${outputDir}`)
      return true
    } catch (error) {
      console.error('❌ Error during transformation:', error)
      return false
    }
  }

  /**
   * Extract tool execution output from Codex payload
   *
   * Attempts to parse the output field from a tool execution payload. Handles both
   * stringified JSON output and direct string/object output. Returns the extracted
   * output or nested output data if present.
   *
   * @param payload - Tool execution payload object containing output field
   * @returns Extracted output as object or string, empty string if parsing fails
   */
  private extractToolOutput(payload: Record<string, unknown>): Record<string, unknown> | string {
    try {
      if (typeof payload.output === 'string') {
        const outputData = JSON.parse(payload.output)
        return (outputData.output as string) || (payload.output as string) || ''
      }

      return (payload.output as string) || ''
    } catch {
      return (payload.output as string) || ''
    }
  }

  /**
   * Extract workspace paths from a Codex payload entry
   *
   * Searches payload for workspace path information in two locations:
   * 1. Direct cwd (current working directory) field
   * 2. writable_roots field (either direct or nested in sandbox_policy)
   * Handles both string and array values for writable_roots.
   *
   * @param payload - Codex payload object to extract paths from
   * @returns Array of workspace path strings found in the payload
   */
  private extractWorkspacePathsFromPayload(payload: Record<string, unknown>): string[] {
    const paths: string[] = []

    // Add cwd if present
    const {cwd} = payload
    if (cwd && typeof cwd === 'string') {
      paths.push(cwd)
    }

    // Add writable_roots if present (can be direct or nested in sandbox_policy)
    let writableRoots = payload.writable_roots

    // If not found, check inside sandbox_policy
    if (!writableRoots && typeof payload.sandbox_policy === 'object' && payload.sandbox_policy !== null) {
      writableRoots = (payload.sandbox_policy as Record<string, unknown>).writable_roots
    }

    if (!writableRoots) {
      return paths
    }

    if (Array.isArray(writableRoots)) {
      for (const root of writableRoots) {
        if (typeof root === 'string') {
          paths.push(root)
        }
      }
    } else if (typeof writableRoots === 'string') {
      paths.push(writableRoots)
    }

    return paths
  }

  /**
   * Normalize a Codex content block to unified ContentBlock format
   *
   * Transforms Codex-specific content block formats to standardized format.
   * Handles multiple block types:
   * - String blocks → text blocks
   * - input_text/output_text → text blocks
   * - thinking blocks
   * - tool_use blocks
   * - tool_result blocks
   * Returns null for invalid or unrecognized blocks.
   *
   * @param block - Codex content block to normalize (string, object, or other)
   * @returns Normalized ContentBlock or null if block is invalid
   */
  private normalizeCodexContentBlock(block: unknown): ContentBlock | null {
    if (typeof block === 'string') {
      return {
        text: block,
        type: 'text',
      }
    }

    if (!block || typeof block !== 'object') {
      return null
    }

    const blockObj = block as Record<string, unknown>

    // Handle input_text/output_text types (Codex format)
    if (blockObj.type === 'input_text' || blockObj.type === 'output_text') {
      return this.normalizeInputTextBlock(blockObj)
    }

    // Handle thinking blocks
    if (blockObj.type === 'thinking') {
      return this.normalizeThinkingBlock(blockObj)
    }

    // Handle text blocks
    if (blockObj.type === 'text') {
      return this.normalizeTextBlock(blockObj)
    }

    // Handle tool_use blocks
    if (blockObj.type === 'tool_use' || (blockObj.name && blockObj.input)) {
      return this.normalizeToolUseBlock(blockObj)
    }

    // Handle tool_result blocks
    if (blockObj.type === 'tool_result' || blockObj.tool_use_id) {
      return this.normalizeToolResultBlock(blockObj)
    }

    // Default: treat as text
    if (blockObj.text) {
      return {
        text: blockObj.text as string,
        type: 'text',
      }
    }

    return null
  }

  /**
   * Normalize Codex session data to unified session format
   *
   * Transforms raw Codex session structure to standardized format:
   * 1. Extracts session metadata from session_meta entry
   * 2. Transforms rawEntries to normalized messages
   * 3. Extracts unique workspace paths from all entries
   * 4. Combines tool use/result messages
   * 5. Assigns turn IDs
   *
   * @param session - Raw Codex session object with rawEntries and metadata
   * @returns Normalized session object with messages, metadata, and workspace paths
   */
  private normalizeCodexSession(session: Record<string, unknown>): Record<string, unknown> {
    const rawEntries = (session.rawEntries as CodexRawEntry[]) || []

    // Find session metadata
    const sessionMeta = rawEntries.find((e) => e.type === 'session_meta')
    const sessionPayload = (sessionMeta?.payload as Record<string, unknown>) || {}

    // Transform raw entries to messages
    const messages = this.transformCodexEntries(rawEntries)

    // Extract unique workspace paths from rawEntries
    const workspacePaths = new Set<string>()

    for (const entry of rawEntries) {
      const payload = entry.payload as Record<string, unknown>
      const paths = this.extractWorkspacePathsFromPayload(payload)
      for (const p of paths) {
        workspacePaths.add(p)
      }
    }

    return {
      id: session.id,
      messages,

      metadata: {
        // eslint-disable-next-line camelcase
        cli_version: sessionPayload.cli_version,
        git: sessionPayload.git,
        // eslint-disable-next-line camelcase
        model_provider: sessionPayload.model_provider,
        originator: sessionPayload.originator,
        source: sessionPayload.source,
      },
      timestamp: session.timestamp,
      title: (session.title as string) || 'Codex Session',
      type: 'Codex',
      workspacePaths: [...workspacePaths].sort(),
    }
  }

  /**
   * Normalize input_text or output_text blocks to standard text format
   *
   * Extracts text content from Codex input_text or output_text blocks and
   * converts them to the unified text content block format.
   *
   * @param blockObj - Codex input/output text block object
   * @returns TextContentBlock with extracted text content
   */
  private normalizeInputTextBlock(blockObj: Record<string, unknown>): TextContentBlock {
    return {
      text: (blockObj.text as string) || '',
      type: 'text',
    }
  }

  /**
   * Normalize standard text content blocks
   *
   * Extracts text field from a content block object and returns it in
   * the standardized text content block format.
   *
   * @param blockObj - Content block object with text field
   * @returns TextContentBlock with extracted text content
   */
  private normalizeTextBlock(blockObj: Record<string, unknown>): TextContentBlock {
    return {
      text: (blockObj.text as string) || '',
      type: 'text',
    }
  }

  /**
   * Normalize thinking content blocks
   *
   * Extracts thinking content from block object, using either the thinking field
   * or falling back to text field. Returns standardized thinking content block.
   *
   * @param blockObj - Content block object with thinking or text field
   * @returns ThinkingContentBlock with extracted thinking content
   */
  private normalizeThinkingBlock(blockObj: Record<string, unknown>): ThinkingContentBlock {
    return {
      thinking: (blockObj.thinking as string) || (blockObj.text as string) || '',
      type: 'thinking',
    }
  }

  /**
   * Normalize tool result content blocks
   *
   * Extracts tool result data from block object, mapping content and tool_use_id
   * fields to the standardized tool result format.
   *
   * @param blockObj - Tool result block object with content and tool_use_id
   * @returns ToolResultContentBlock with extracted result data
   */
  private normalizeToolResultBlock(blockObj: Record<string, unknown>): ToolResultContentBlock {
    return {
      content: (blockObj.content as Record<string, unknown> | string) || (blockObj.text as string) || '',
      // eslint-disable-next-line camelcase
      tool_use_id: (blockObj.tool_use_id as string) || '',
      type: 'tool_result',
    }
  }

  /**
   * Normalize tool use content blocks
   *
   * Extracts tool invocation data from block object, mapping id, name, input,
   * and tool_use_id fields to the standardized tool use format.
   *
   * @param blockObj - Tool use block object with tool invocation data
   * @returns ToolUseContentBlock with extracted tool invocation data
   */
  private normalizeToolUseBlock(blockObj: Record<string, unknown>): ToolUseContentBlock {
    return {
      id: (blockObj.id as string) || '',
      input: (blockObj.input as Record<string, unknown>) || {},
      name: (blockObj.name as string) || '',
      // eslint-disable-next-line camelcase
      tool_use_id: (blockObj.tool_use_id as string) || (blockObj.id as string) || '',
      type: 'tool_use',
    }
  }

  /**
   * Parse tool input from payload supporting multiple Codex formats
   *
   * Extracts and normalizes tool input arguments from different payload formats:
   * - custom_tool_call: wraps input in an object
   * - function_call: parses arguments (string or object)
   * Handles JSON parsing for stringified arguments with fallback to wrapped format.
   *
   * @param payload - Tool call payload with input or arguments field
   * @returns Parsed tool input as object, empty object if no input found
   */
  private parseToolInput(payload: Record<string, unknown>): Record<string, unknown> {
    if (payload.input !== undefined) {
      // custom_tool_call: wrap input in an object
      return typeof payload.input === 'string' ? { input: payload.input } : (payload.input as Record<string, unknown>) || {}
    }

    if (payload.arguments !== undefined) {
      // function_call: arguments are already an object
      if (typeof payload.arguments === 'string') {
        try {
          return JSON.parse(payload.arguments)
        } catch {
          return { arguments: payload.arguments }
        }
      }

      return (payload.arguments as Record<string, unknown>) || {}
    }

    return {}
  }

  /**
   * Process message payload and append content blocks to array
   *
   * Extracts message content array from payload and processes each content block,
   * appending normalized blocks to the provided content array.
   *
   * @param payload - Message payload object with content array
   * @param content - Array to append processed content blocks to (modified in place)
   */
  private processMessage(payload: Record<string, unknown>, content: ContentBlock[]): void {
    const msgContent = payload.content as unknown[] || []
    content.push(...this.processMessageContent(msgContent))
  }

  /**
   * Process and normalize message content blocks from array
   *
   * Iterates through message content array, normalizing each block to the
   * unified ContentBlock format. Filters out any null results from normalization.
   *
   * @param msgContent - Array of raw message content blocks
   * @returns Array of normalized ContentBlock objects
   */
  private processMessageContent(msgContent: unknown[]): ContentBlock[] {
    const content: ContentBlock[] = []
    if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        const contentBlock = this.normalizeCodexContentBlock(block)
        if (contentBlock) {
          content.push(contentBlock)
        }
      }
    }

    return content
  }

  /**
   * Process reasoning payload and append thinking blocks to content array
   *
   * Extracts summary array from reasoning payload and processes it into
   * thinking content blocks, appending them to the provided content array.
   *
   * @param payload - Reasoning payload object with summary array
   * @param content - Array to append thinking blocks to (modified in place)
   */
  private processReasoning(payload: Record<string, unknown>, content: ContentBlock[]): void {
    const summary = (payload.summary as unknown[]) || []
    content.push(...this.processReasoningContent(summary))
  }

  /**
   * Process reasoning summary into thinking content blocks
   *
   * Extracts text from summary_text type blocks in the summary array and
   * converts them to thinking content blocks.
   *
   * @param summary - Array of summary blocks from reasoning payload
   * @returns Array of ThinkingContentBlock objects extracted from summary
   */
  private processReasoningContent(summary: unknown[]): ContentBlock[] {
    const content: ContentBlock[] = []
    if (Array.isArray(summary)) {
      for (const block of summary as Array<Record<string, unknown>>) {
        if (block.type === 'summary_text' && block.text) {
          content.push({
            thinking: block.text as string,
            type: 'thinking',
          } as ContentBlock)
        }
      }
    }

    return content
  }

  /**
   * Process Codex response item into a CleanMessage
   *
   * Transforms a Codex raw entry (response_item) into a normalized message.
   * Handles different item types:
   * - custom_tool_call/function_call → tool use blocks (assistant)
   * - custom_tool_call_output/function_call_output → tool result blocks (assistant)
   * - message → text content (user or assistant based on role)
   * - reasoning → thinking blocks (assistant)
   * Returns null if no content blocks are generated.
   *
   * @param item - Codex raw entry to process
   * @returns CleanMessage with type, content, and timestamp, or null if no content
   */
  private processResponseItem(item: CodexRawEntry): CleanMessage | null {
    const payload = item.payload as Record<string, unknown>
    const itemType = payload.type as string
    const role = (payload.role as 'assistant' | 'user' | undefined) || 'assistant'
    const timestampIso = typeof item.timestamp === 'string' ? item.timestamp : new Date(item.timestamp).toISOString()

    let messageType: 'assistant' | 'user' = role
    const content: ContentBlock[] = []

    switch (itemType) {
      case 'custom_tool_call':
      case 'function_call': {
        this.processToolCall(payload, content)
        messageType = 'assistant'
        break
      }

      case 'custom_tool_call_output':
      case 'function_call_output': {
        this.processToolOutput(payload, content)
        messageType = 'assistant'
        break
      }

      case 'message': {
        messageType = (payload.role as 'assistant' | 'user') || 'assistant'
        this.processMessage(payload, content)
        break
      }

      case 'reasoning': {
        this.processReasoning(payload, content)
        messageType = 'assistant'
        break
      }
    }

    if (content.length === 0) {
      return null
    }

    return {
      content,
      timestamp: timestampIso,
      type: messageType,
    }
  }

  /**
   * Process tool call payload and append tool use block to content
   *
   * Parses tool input from payload and creates a tool_use content block with
   * call ID, input, and tool name. Appends the block to the provided array.
   *
   * @param payload - Tool call payload with name, input/arguments, and call_id
   * @param content - Array to append tool use block to (modified in place)
   */
  private processToolCall(payload: Record<string, unknown>, content: ContentBlock[]): void {
    const toolInput = this.parseToolInput(payload)

    content.push({
      id: (payload.call_id as string) || (payload.tool_call_id as string) || '',
      input: toolInput,
      name: (payload.name as string) || '',
      // eslint-disable-next-line camelcase
      tool_use_id: (payload.call_id as string) || (payload.tool_call_id as string) || '',
      type: 'tool_use',
    } as ContentBlock)
  }

  /**
   * Process tool output payload and append tool result block to content
   *
   * Extracts tool execution output from payload and creates a tool_result
   * content block with the output content and tool_use_id. Appends the block
   * to the provided array.
   *
   * @param payload - Tool output payload with output field and call_id
   * @param content - Array to append tool result block to (modified in place)
   */
  private processToolOutput(payload: Record<string, unknown>, content: ContentBlock[]): void {
    const outputContent = this.extractToolOutput(payload)

    content.push({
      content: outputContent,
      // eslint-disable-next-line camelcase
      tool_use_id: (payload.call_id as string) || (payload.tool_call_id as string) || '',
      type: 'tool_result',
    } as ContentBlock)
  }

  /**
   * Transform Codex rawEntries to unified message format with turn IDs
   *
   * Performs complete transformation pipeline:
   * 1. Filters out event_msg and turn_context entries
   * 2. Processes each response_item into a message
   * 3. Sorts messages by timestamp
   * 4. Combines tool_use and tool_result messages
   * 5. Assigns turn IDs to all messages
   *
   * @param rawEntries - Array of Codex raw entries from session
   * @returns Array of CleanMessage objects with turn IDs and combined tool blocks
   */
  private transformCodexEntries(rawEntries: CodexRawEntry[]): CleanMessage[] {
    // Filter out event_msg and turn_context entries - keep only response_item and session_meta
    const filteredEntries = rawEntries.filter(
      (entry) => entry.type !== 'event_msg' && entry.type !== 'turn_context'
    )

    const responseItems = filteredEntries.filter((e) => e.type === 'response_item')
    const messages: CleanMessage[] = []

    // Process each response item into its own message
    for (const item of responseItems) {
      const message = this.processResponseItem(item)
      if (message) {
        messages.push(message)
      }
    }

    // Sort messages by timestamp
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Combine tool_use and tool_result messages
    const combinedMessages = combineToolResults(messages)

    // Add turn_id
    const finalMessages = addTurnIds(combinedMessages)

    return finalMessages
  }
}
