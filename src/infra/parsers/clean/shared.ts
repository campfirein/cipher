/**
 * Shared transformation utilities for all clean parsers
 * Provides centralized session normalization implementation
 */

import {
  CleanMessage,
  CleanSession,
  ContentBlock,
  SessionType,
  ToolResultContentBlock,
  ToolUseContentBlock,
} from '../../../core/domain/entities/parser.js'
import { ISessionNormalizer } from '../../../core/interfaces/parser/i-session-normalizer.js'

/**
 * Session Normalizer implementation
 * Provides shared normalization utilities for all clean parsers
 */
export class SessionNormalizer implements ISessionNormalizer {
  /**
   * Add turn_id to each message based on timestamp order
   *
   * Assigns sequential turn_id values (1-based) to all messages to track
   * their order in the conversation.
   *
   * @param messages - Array of messages to assign turn IDs to
   * @returns Array of messages with turn_id property added
   */
  addTurnIds(messages: CleanMessage[]): CleanMessage[] {
    return messages.map((msg, index) => ({
      ...msg,
      // eslint-disable-next-line camelcase
      turn_id: index + 1,
    }))
  }

  /**
   * Combine tool_use and tool_result messages
   *
   * Merges separate tool_use and tool_result content blocks into single blocks
   * with embedded output. Removes standalone tool_result blocks after combining.
   * Two-pass algorithm: first collect results by ID, then merge with tool_use blocks.
   *
   * @param messages - Array of clean messages to process
   * @returns Array of messages with combined tool execution blocks
   */
  combineToolResults(messages: CleanMessage[]): CleanMessage[] {
    const combined: CleanMessage[] = []
    const toolResults: Record<string, ToolResultContentBlock> = {}

    // First pass: collect tool results by tool_use_id
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const toolBlock = block as ToolResultContentBlock
          toolResults[toolBlock.tool_use_id] = toolBlock
        }
      }
    }

    // Second pass: combine tool_use with results
    for (const msg of messages) {
      const combinedContent: ContentBlock[] = []

      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          const toolBlock = block as ToolUseContentBlock
          if (toolBlock.id && toolResults[toolBlock.id]) {
            // Attach result to tool_use, preserving tool_use_id
            const result = toolResults[toolBlock.id]
            const resultData = { ...result } as Record<string, unknown>
            delete resultData.tool_use_id

            combinedContent.push({
              ...toolBlock,
              output: resultData,
              // eslint-disable-next-line camelcase
              tool_use_id: toolBlock.id,
            } as unknown as ContentBlock)
          } else {
            combinedContent.push(block)
          }
        } else if (block.type !== 'tool_result') {
          // Skip tool_result blocks (they're now merged)
          combinedContent.push(block)
        }
      }

      if (combinedContent.length > 0) {
        combined.push({
          ...msg,
          content: combinedContent,
        })
      }
    }

    return combined
  }

  /**
   * Extract unique workspace paths from session messages and metadata
   *
   * Collects workspace paths from multiple sources: existing paths, message cwd properties,
   * and metadata cwd property. Removes duplicates and sorts alphabetically.
   *
   * @param messages - Array of clean messages to extract paths from
   * @param metadata - Session metadata object (may contain cwd property)
   * @param existingPaths - Optional pre-existing paths to include
   * @returns Sorted array of unique workspace paths
   */
  extractWorkspacePaths(
    messages: CleanMessage[],
    metadata: unknown,
    existingPaths?: string[]
  ): string[] {
    const paths = new Set<string>()

    // Start with existing paths if provided
    if (existingPaths && Array.isArray(existingPaths)) {
      for (const p of existingPaths) {
        if (p && typeof p === 'string') {
          paths.add(p)
        }
      }
    }

    // Extract from messages
    for (const msg of messages) {
      const {cwd} = (msg as Record<string, unknown>)
      if (cwd && typeof cwd === 'string') {
        paths.add(cwd)
      }
    }

    // Extract from metadata
    if (typeof metadata === 'object' && metadata !== null) {
      const metaObj = metadata as Record<string, unknown>
      if (metaObj.cwd && typeof metaObj.cwd === 'string') {
        paths.add(metaObj.cwd)
      }
    }

    return [...paths].sort()
  }

  /**
   * Normalize message content to always be an array of content blocks
   *
   * Converts various content formats (string, array, object) into a standardized
   * array of ContentBlock objects for consistent processing.
   *
   * @param content - Content to normalize (can be string, array of blocks, object, or any value)
   * @returns Array of normalized ContentBlock objects
   */
  normalizeContent(content: unknown): ContentBlock[] {
    if (Array.isArray(content)) {
      return content.map((block) => this.normalizeContentBlock(block))
    }

    if (typeof content === 'string') {
      return [
        {
          text: content,
          type: 'text',
        },
      ]
    }

    if (typeof content === 'object' && content !== null) {
      return [this.normalizeContentBlock(content)]
    }

    return []
  }

  /**
   * Normalize a single content block
   *
   * Converts a block into a properly typed ContentBlock. Infers the block type
   * from its properties if not explicitly specified (text, thinking, tool_use, tool_result).
   *
   * @param block - Block to normalize (string, object, or any value)
   * @returns Normalized ContentBlock with proper type inference
   */
  normalizeContentBlock(block: unknown): ContentBlock {
    if (typeof block === 'string') {
      return {
        text: block,
        type: 'text',
      }
    }

    if (typeof block !== 'object' || block === null) {
      return { text: String(block), type: 'text' }
    }

    const blockObj = block as Record<string, unknown>
    const normalized: Record<string, unknown> = { ...blockObj }

    // Remove redundant 'signature' property
    delete normalized.signature

    // Ensure proper type for content blocks
    if (!normalized.type) {
      if ('text' in normalized) {
        normalized.type = 'text'
      } else if ('thinking' in normalized) {
        normalized.type = 'thinking'
      } else if ('name' in normalized && 'input' in normalized) {
        normalized.type = 'tool_use'
      } else if ('tool_use_id' in normalized) {
        normalized.type = 'tool_result'
      } else {
        normalized.type = 'text'
      }
    }

    return normalized as ContentBlock
  }

  /**
   * Normalize Claude session format
   *
   * Transforms raw session data into standardized CleanSession format. Normalizes message
   * content to content blocks, combines tool calls with results, assigns turn IDs,
   * and extracts workspace paths. Handles sessions from Claude, Copilot, Cursor, and Codex.
   *
   * @param session - Raw session object with messages and metadata
   * @param sessionType - Type of session (Claude, Copilot, Cursor, Codex)
   * @returns Normalized CleanSession with standardized format
   */
  normalizeSession(session: Record<string, unknown>, sessionType: SessionType = 'Claude'): CleanSession {
    // Normalize messages
    const rawMessages = (session.messages as unknown[]) || []
    let normalizedMessages: CleanMessage[] = rawMessages.map((rawMsg) => {
      const msg = rawMsg as Record<string, unknown>
      const msgType = (msg.type as 'assistant' | 'user') || 'user'
      const timestamp = (msg.timestamp as string) || new Date().toISOString()

      // Normalize content to array format
      const contentArray = this.normalizeContent(msg.content)

      // Set default type for content blocks based on message type
      const processedContent = contentArray.map((block) => {
        if (msgType === 'user' && !block.type) {
          return { ...block, type: 'text' } as ContentBlock
        }

        if (msgType === 'assistant' && !block.type) {
          return { ...block, type: 'thinking' } as ContentBlock
        }

        return block
      })

      const normalizedMsg: CleanMessage = {
        content: processedContent,
        timestamp,
        type: msgType,
      }

      // Copy over other properties except content, type, and timestamp
      for (const [key, value] of Object.entries(msg)) {
        if (key !== 'content' && key !== 'type' && key !== 'timestamp' && value !== undefined) {
          ;(normalizedMsg as Record<string, unknown>)[key] = value
        }
      }

      return normalizedMsg
    })

    // Combine tool_use and tool_result messages
    normalizedMessages = this.combineToolResults(normalizedMessages)

    // Add turn_id based on timestamp order
    normalizedMessages = this.addTurnIds(normalizedMessages)

    // Extract unique workspace paths - preserve existing ones if already set
    const existingPaths = (session.workspacePaths as string[] | undefined) || undefined
    const workspacePaths = this.extractWorkspacePaths(normalizedMessages, session.metadata, existingPaths)

    // Return normalized session
    return {
      id: (session.id as string) || '',
      messages: normalizedMessages,
      metadata: session.metadata,
      timestamp: (session.timestamp as number) || Date.now(),
      title: (session.title as string) || '',
      type: sessionType,
      workspacePaths: workspacePaths.length > 0 ? workspacePaths : [],
    }
  }
}

// Export singleton instance for convenience
export const sessionNormalizer = new SessionNormalizer()

// Re-export standalone functions for backward compatibility
export function normalizeClaudeSession(session: Record<string, unknown>, sessionType: SessionType = 'Claude'): CleanSession {
  return sessionNormalizer.normalizeSession(session, sessionType)
}

export function normalizeContent(content: unknown): ContentBlock[] {
  return sessionNormalizer.normalizeContent(content)
}

export function normalizeContentBlock(block: unknown): ContentBlock {
  return sessionNormalizer.normalizeContentBlock(block)
}

export function combineToolResults(messages: CleanMessage[]): CleanMessage[] {
  return sessionNormalizer.combineToolResults(messages)
}

export function addTurnIds(messages: CleanMessage[]): CleanMessage[] {
  return sessionNormalizer.addTurnIds(messages)
}

export function extractWorkspacePaths(
  messages: CleanMessage[],
  metadata: unknown,
  existingPaths?: string[]
): string[] {
  return sessionNormalizer.extractWorkspacePaths(messages, metadata, existingPaths)
}
