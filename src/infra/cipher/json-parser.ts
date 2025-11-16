import fs from 'node:fs'

import type {InternalMessage, ToolCall} from '../../core/interfaces/cipher/message-types.js'

/**
 * Cursor conversation JSON format types
 * Based on the example format from Cursor IDE
 */

interface CursorTextContent {
  text: string
  type: 'text'
}

interface CursorToolUseContent {
  id: string
  input: Record<string, unknown>
  name: string
  output?: {
    content: Record<string, unknown>
    type: 'tool_result'
  }
  type: 'tool_use'
}

type CursorMessageContent = CursorTextContent | CursorToolUseContent

interface CursorMessage {
  content: CursorMessageContent[]
  timestamp: string
  turn_id: number
  type: 'assistant' | 'user'
}

interface CursorConversation {
  id: string
  messages: CursorMessage[]
  timestamp: number
  title: string
  type: string
}

/**
 * Parsed conversation result
 */
export interface ParsedConversation {
  /** Last user message as the current prompt */
  currentPrompt: string

  /** Complete conversation history in CipherAgent InternalMessage format */
  history: InternalMessage[]

  /** Original conversation metadata */
  metadata: {
    conversationId: string
    title: string
    type: string
  }
}

/**
 * Parse Cursor conversation JSON format and convert to CipherAgent message format
 *
 * @param filePath - Path to the JSON file
 * @returns Parsed conversation with history and current prompt
 * @throws Error if file doesn't exist, JSON is invalid, or format is unexpected
 */
export function parseCursorConversation(filePath: string): ParsedConversation {
  // Read file
  let fileContent: string
  try {
    fileContent = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }

    throw new Error(`Failed to read file: ${(error as Error).message}`)
  }

  // Parse JSON
  let conversation: CursorConversation
  try {
    conversation = JSON.parse(fileContent) as CursorConversation
  } catch (error) {
    throw new Error(`Invalid JSON format: ${(error as Error).message}`)
  }

  // Validate structure
  if (!conversation.messages || !Array.isArray(conversation.messages)) {
    throw new Error('Invalid conversation format: missing or invalid "messages" array')
  }

  if (conversation.messages.length === 0) {
    throw new Error('Conversation has no messages')
  }

  // Sort messages by turn_id to ensure chronological order
  const sortedMessages = [...conversation.messages].sort((a, b) => a.turn_id - b.turn_id)

  // Convert to CipherAgent InternalMessage format
  const history: InternalMessage[] = []
  let currentPrompt = ''

  for (const cursorMsg of sortedMessages) {
    // Process each content block in the message
    for (const content of cursorMsg.content) {
      if (content.type === 'text') {
        // Text message
        const message: InternalMessage = {
          content: content.text,
          role: cursorMsg.type === 'user' ? 'user' : 'assistant',
        }

        history.push(message)

        // Track last user message as current prompt
        if (cursorMsg.type === 'user') {
          currentPrompt = content.text
        }
      } else if (content.type === 'tool_use') {
        // Tool call from assistant - convert to InternalMessage format
        const toolCall: ToolCall = {
          function: {
            arguments: JSON.stringify(content.input),
            name: content.name,
          },
          id: content.id,
          type: 'function',
        }

        // Add assistant message with tool call
        const assistantMsg: InternalMessage = {
          content: null, // Tool calls don't have text content
          role: 'assistant',
          toolCalls: [toolCall],
        }

        history.push(assistantMsg)

        // If tool has output, add tool result message
        if (content.output) {
          const toolResultMsg: InternalMessage = {
            content: JSON.stringify(content.output.content),
            name: content.name,
            role: 'tool',
            toolCallId: content.id,
          }

          history.push(toolResultMsg)
        }
      }
    }
  }

  // Validate we have at least one user message
  if (!currentPrompt) {
    throw new Error('No user messages found in conversation')
  }

  return {
    currentPrompt,
    history,
    metadata: {
      conversationId: conversation.id,
      title: conversation.title,
      type: conversation.type,
    },
  }
}

/**
 * Load and parse conversation from file with error handling
 *
 * @param filePath - Path to JSON file
 * @returns Parsed conversation or null if parsing fails
 */
export function loadConversation(filePath: string): null | ParsedConversation {
  try {
    return parseCursorConversation(filePath)
  } catch {
    return null
  }
}
