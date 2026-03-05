/**
 * Shared compression helper functions.
 *
 * Extracted from ReactiveOverflowStrategy to enable reuse
 * by EscalatedCompressionStrategy and other compression implementations.
 */

import type {ITokenizer} from '../../../../core/interfaces/i-tokenizer.js'
import type {InternalMessage, TextPart} from '../../../../core/interfaces/message-types.js'

import {isTextPart} from '../../../../core/interfaces/message-type-guards.js'

/**
 * Count tokens in message history.
 */
export function countHistoryTokens(history: InternalMessage[], tokenizer: ITokenizer): number {
  let total = 0

  for (const message of history) {
    total += countMessageTokens(message, tokenizer)
  }

  return total
}

/**
 * Count tokens in a single message.
 */
export function countMessageTokens(message: InternalMessage, tokenizer: ITokenizer): number {
  // Role overhead (approximately 4 tokens)
  let tokens = 4

  if (typeof message.content === 'string') {
    tokens += tokenizer.countTokens(message.content)
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      tokens += isTextPart(part) ? tokenizer.countTokens(part.text) : 100
    }
  }

  // Tool calls overhead
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      tokens += tokenizer.countTokens(call.function.name)
      tokens += tokenizer.countTokens(call.function.arguments)
    }
  }

  return tokens
}

/**
 * Extract text content from a message.
 */
export function extractTextContent(message: InternalMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((p): p is TextPart => isTextPart(p))
      .map((p) => p.text)
      .join('\n')
  }

  return ''
}

/**
 * Find turn boundaries in message history.
 *
 * A turn boundary is the index where a user message starts.
 * Returns indices of all user messages.
 */
export function findTurnBoundaries(messages: InternalMessage[]): number[] {
  const boundaries: number[] = []

  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') {
      boundaries.push(index)
    }
  }

  return boundaries
}

/**
 * Format messages for the summary prompt.
 */
export function formatMessagesForSummary(messages: InternalMessage[]): string {
  const MAX_TOTAL_CHARS = 50_000
  const MAX_PER_MESSAGE_CHARS = 1000
  const lines: string[] = []
  let totalChars = 0

  for (const message of messages) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      lines.push(`[... ${messages.length - lines.length} more messages truncated for summarization]`)

      break
    }

    const role = formatRole(message.role)
    const content = extractTextContent(message)

    // Truncate very long messages (capped at 1K chars to prevent overflow)
    const truncatedContent = content.length > MAX_PER_MESSAGE_CHARS
      ? `${content.slice(0, MAX_PER_MESSAGE_CHARS)}... [truncated]`
      : content

    if (truncatedContent) {
      lines.push(`${role}: ${truncatedContent}`)
      totalChars += truncatedContent.length
    }

    // Include tool call information
    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolNames = message.toolCalls.map((tc) => tc.function.name).join(', ')
      lines.push(`[Used tools: ${toolNames}]`)
      totalChars += toolNames.length + 15
    }
  }

  return lines.join('\n\n')
}

/**
 * Format role for display.
 */
export function formatRole(role: string): string {
  switch (role) {
    case 'assistant': {
      return 'Assistant'
    }

    case 'system': {
      return 'System'
    }

    case 'tool': {
      return 'Tool Result'
    }

    case 'user': {
      return 'User'
    }

    default: {
      return role.charAt(0).toUpperCase() + role.slice(1)
    }
  }
}
