import type {ITokenizer} from '../../../../core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage} from '../../../../core/interfaces/cipher/message-types.js'

/**
 * Count tokens for a single content part
 *
 * @param part - Content part
 * @param part.text - Text content (for text type)
 * @param part.type - Type of content part
 * @param tokenizer - Tokenizer for counting
 * @returns Token count for the part
 */
function countPartTokens(
  part: {text?: string; type: 'file' | 'image' | 'text'},
  tokenizer: ITokenizer,
): number {
  switch (part.type) {
    case 'file': {
      // File content - rough estimate
      // Similar to images, files can vary widely in token cost
      return 100
    }

    case 'image': {
      // Image content - rough estimate
      // Images are typically encoded and consume significant tokens
      // Conservative estimate: ~100 tokens per image
      return 100
    }

    case 'text': {
      // Text content - use tokenizer
      return tokenizer.countTokens(part.text ?? '')
    }

    default: {
      return 0
    }
  }
}

/**
 * Count tokens for message content
 *
 * @param content - Message content
 * @param tokenizer - Tokenizer for counting
 * @returns Token count for the content
 */
function countContentTokens(
  content: InternalMessage['content'],
  tokenizer: ITokenizer,
): number {
  if (!content) {
    return 0
  }

  if (typeof content === 'string') {
    // String content - use tokenizer
    return tokenizer.countTokens(content)
  }

  if (Array.isArray(content)) {
    // Array of parts (text, images, files)
    let tokens = 0

    for (const part of content) {
      tokens += countPartTokens(part, tokenizer)
    }

    return tokens
  }

  return 0
}

/**
 * Count total tokens in a message array.
 * Adapted from dexto's token counting logic for cipher context.
 *
 * This provides a comprehensive token count including:
 * - Role metadata tokens
 * - Text content tokens
 * - Multimodal content tokens (images, files)
 * - Tool call tokens
 *
 * @param messages - Array of internal messages
 * @param tokenizer - Tokenizer for counting
 * @returns Total token count
 */
export function countMessagesTokens(
  messages: InternalMessage[],
  tokenizer: ITokenizer,
): number {
  let totalTokens = 0

  for (const message of messages) {
    // Role token overhead (estimated)
    // Each message has role metadata that consumes tokens
    totalTokens += 4

    // Content tokens
    totalTokens += countContentTokens(message.content, tokenizer)

    // Tool call tokens
    if (message.toolCalls) {
      for (const call of message.toolCalls) {
        // Tool calls are serialized as JSON
        const callJson = JSON.stringify(call)
        totalTokens += tokenizer.countTokens(callJson)
      }
    }
  }

  return totalTokens
}
