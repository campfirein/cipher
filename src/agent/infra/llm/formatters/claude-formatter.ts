/* eslint-disable camelcase */
import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsBase,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages'

import type {IMessageFormatter} from '../../../core/interfaces/i-message-formatter.js'
import type {InternalMessage, MessagePart, ToolCall} from '../../../core/interfaces/message-types.js'

// Re-export Anthropic SDK types for convenience
export type {MessageParam as ClaudeMessage, Message as ClaudeResponse} from '@anthropic-ai/sdk/resources/messages'

// Type alias for Claude generation config (subset of MessageCreateParamsBase)
export type ClaudeGenerationConfig = Pick<
  MessageCreateParamsBase,
  'max_tokens' | 'system' | 'temperature' | 'tools'
>

/**
 * Message formatter for Anthropic Claude API.
 *
 * Converts the internal message format to Claude's specific structure:
 * - System prompts are NOT included in messages (handled separately in config)
 * - Uses 'assistant' role (not 'model' like Gemini)
 * - Tool calls use tool_use blocks with id and input
 * - Tool results use tool_result blocks with tool_use_id
 */
export class ClaudeMessageFormatter implements IMessageFormatter<MessageParam> {
  /**
   * Formats internal messages into Claude's API format.
   *
   * IMPORTANT: System prompts are NOT included in the returned array.
   * They should be passed separately via the config.system parameter.
   *
   * @param history Array of internal messages to format
   * @param _systemPrompt System prompt (ignored - handled separately in config)
   * @returns Array of MessageParam objects formatted for Claude's API
   */
  public format(
    history: Readonly<InternalMessage[]>,
    _systemPrompt?: null | string,
  ): MessageParam[] {
    const messages: MessageParam[] = []

    // Note: System prompt is NOT added to messages for Claude
    // It's passed separately via config.system parameter

    for (const msg of history) {
      switch (msg.role) {
        case 'assistant': {
          messages.push(this.formatAssistantMessage(msg))
          break
        }

        case 'system': {
          // Skip system messages - they should be in config.system
          // Additional system messages in history are ignored
          break
        }

        case 'tool': {
          messages.push(this.formatToolResult(msg))
          break
        }

        case 'user': {
          messages.push(this.formatUserMessage(msg))
          break
        }
      }
    }

    return messages
  }

  /**
   * Parses Claude API response into internal message objects.
   *
   * @param response The raw response from Claude API
   * @returns Array of internal messages (typically one assistant message)
   */
  public parseResponse(response: unknown): InternalMessage[] {
    const typedResponse = response as Message
    if (!typedResponse.content || typedResponse.content.length === 0) {
      return []
    }

    const textParts: string[] = []
    const toolUses: ToolUseBlock[] = []

    // Extract text and tool uses from response content blocks
    for (const block of typedResponse.content) {
      if (block.type === 'text') {
        textParts.push(block.text)
      } else if (block.type === 'tool_use') {
        toolUses.push(block)
      }
    }

    // Convert to internal message format
    const toolCalls: ToolCall[] | undefined =
      toolUses.length > 0
        ? toolUses.map((tu) => ({
            function: {
              arguments: JSON.stringify(tu.input),
              name: tu.name,
            },
            id: tu.id,
            type: 'function',
          }))
        : undefined

    return [
      {
        content: textParts.join('') || null,
        role: 'assistant',
        toolCalls,
      },
    ]
  }

  /**
   * Formats assistant message to Claude's format.
   * Uses 'assistant' role and includes both text and tool_use blocks.
   */
  private formatAssistantMessage(msg: InternalMessage): MessageParam {
    const contentBlocks: ContentBlockParam[] = []

    // Add text content if present
    if (msg.content) {
      contentBlocks.push({
        text: String(msg.content),
        type: 'text',
      } as TextBlockParam)
    }

    // Add tool calls if present
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        contentBlocks.push({
          id: tc.id,
          input: JSON.parse(tc.function.arguments),
          name: tc.function.name,
          type: 'tool_use',
        } as ToolUseBlockParam)
      }
    }

    return {
      content: contentBlocks,
      role: 'assistant',
    }
  }

  /**
   * Formats tool result message to Claude's format.
   * Tool results are sent as user messages with tool_result blocks.
   */
  private formatToolResult(msg: InternalMessage): MessageParam {
    return {
      content: [
        {
          content: String(msg.content ?? ''),
          tool_use_id: msg.toolCallId ?? '',
          type: 'tool_result',
        } as ToolResultBlockParam,
      ],
      role: 'user',
    }
  }

  /**
   * Formats a single user content part.
   * Currently supports text parts, with placeholders for image/file support.
   */
  private formatUserContentPart(part: MessagePart): ContentBlockParam {
    if (part.type === 'text') {
      return {text: part.text, type: 'text'} as TextBlockParam
    }

    if (part.type === 'image') {
      // Image support not yet implemented for Claude
      // Claude supports images via base64 encoded data
      return {text: '[Image not yet supported]', type: 'text'} as TextBlockParam
    }

    if (part.type === 'file') {
      // File support not yet implemented for Claude
      return {text: '[File not yet supported]', type: 'text'} as TextBlockParam
    }

    return {text: '[Unknown content type]', type: 'text'} as TextBlockParam
  }

  /**
   * Formats user message to Claude's format.
   * Handles both simple string content and multimodal content blocks.
   */
  private formatUserMessage(msg: InternalMessage): MessageParam {
    if (typeof msg.content === 'string') {
      // Simple text message
      return {
        content: msg.content,
        role: 'user',
      }
    }

    if (Array.isArray(msg.content)) {
      // Multimodal content (text, images, files)
      const contentBlocks: ContentBlockParam[] = []
      for (const part of msg.content) {
        contentBlocks.push(this.formatUserContentPart(part))
      }

      return {
        content: contentBlocks,
        role: 'user',
      }
    }

    // Empty content
    return {
      content: '',
      role: 'user',
    }
  }
}
