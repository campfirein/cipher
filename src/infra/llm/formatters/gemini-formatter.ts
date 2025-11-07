import type {Content, FunctionCall, GenerateContentResponse, Part} from '@google/genai'

import type {IMessageFormatter} from '../../../core/interfaces/i-message-formatter.js'
import type {InternalMessage, MessagePart, ToolCall} from '../../../core/interfaces/message-types.js'

/**
 * Message formatter for Google Gemini API.
 *
 * Converts the internal message format to Gemini's specific structure:
 * - Maps 'assistant' role to 'model' (Gemini's terminology)
 * - System prompts are injected as user messages (Gemini doesn't have system role)
 * - Tool calls use functionCall parts
 * - Tool results use functionResponse parts in user messages
 */
export class GeminiMessageFormatter implements IMessageFormatter<Content> {
  /**
   * Formats internal messages into Gemini's API format.
   *
   * @param history Array of internal messages to format
   * @param systemPrompt Optional system prompt to include at the beginning
   * @returns Array of Content objects formatted for Gemini's API
   */
  public format(
    history: Readonly<InternalMessage[]>,
    systemPrompt?: null | string,
  ): Content[] {
    const contents: Content[] = []

    // Add system prompt as a user message if provided
    // Gemini doesn't have a separate system role
    if (systemPrompt) {
      contents.push({
        parts: [{text: `System: ${systemPrompt}`}],
        role: 'user',
      })
    }

    for (const msg of history) {
      switch (msg.role) {
        case 'assistant': {
          contents.push(this.formatAssistantMessage(msg))
          break
        }

        case 'system': {
          // Additional system messages in history
          contents.push({
            parts: [{text: `System: ${String(msg.content || '')}`}],
            role: 'user',
          })
          break
        }

        case 'tool': {
          contents.push(this.formatToolResult(msg))
          break
        }

        case 'user': {
          contents.push(this.formatUserMessage(msg))
          break
        }
      }
    }

    return contents
  }

  /**
   * Parses Gemini API response into internal message objects.
   *
   * @param response The raw response from Gemini API
   * @returns Array of internal messages (typically one assistant message)
   */
  public parseResponse(response: unknown): InternalMessage[] {
    const typedResponse = response as GenerateContentResponse
    if (!typedResponse.candidates || typedResponse.candidates.length === 0) {
      return []
    }

    const candidate = typedResponse.candidates[0]
    if (!candidate?.content?.parts) {
      return []
    }

    const textParts: string[] = []
    const functionCalls: FunctionCall[] = []

    // Extract text and function calls from response parts
    for (const part of candidate.content.parts) {
      if ('text' in part && part.text) {
        textParts.push(part.text)
      }

      if ('functionCall' in part && part.functionCall) {
        functionCalls.push(part.functionCall)
      }
    }

    // Convert to internal message format
    const toolCalls: ToolCall[] | undefined =
      functionCalls.length > 0
        ? functionCalls.map((fc) => ({
            function: {
              arguments: JSON.stringify(fc.args ?? {}),
              name: fc.name ?? '',
            },
            id: this.generateToolCallId(fc.name ?? ''),
            type: 'function' as const,
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
   * Formats assistant message to Gemini's Content format.
   * Maps 'assistant' role to 'model' and includes both text and tool calls.
   */
  private formatAssistantMessage(msg: InternalMessage): Content {
    const parts: Part[] = []

    // Add text content if present
    if (msg.content) {
      parts.push({text: String(msg.content)})
    }

    // Add tool calls if present
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            args: JSON.parse(tc.function.arguments),
            name: tc.function.name,
          },
        })
      }
    }

    return {
      parts,
      role: 'model', // Gemini uses 'model' instead of 'assistant'
    }
  }

  /**
   * Formats tool result message to Gemini's Content format.
   * Tool results are sent as user messages with functionResponse parts.
   */
  private formatToolResult(msg: InternalMessage): Content {
    return {
      parts: [
        {
          functionResponse: {
            name: msg.name ?? '',
            response: {
              result: msg.content,
            },
          },
        },
      ],
      role: 'user', // Tool results are sent as user messages in Gemini
    }
  }

  /**
   * Formats a single user content part.
   * Currently supports text parts, with placeholders for image/file support.
   */
  private formatUserContentPart(part: MessagePart): Part {
    if (part.type === 'text') {
      return {text: part.text}
    }

    if (part.type === 'image') {
      // Image support not yet implemented for Gemini
      // Gemini supports inline images via inlineData or fileData
      return {text: '[Image not yet supported]'}
    }

    if (part.type === 'file') {
      // File support not yet implemented for Gemini
      return {text: '[File not yet supported]'}
    }

    return {text: '[Unknown content type]'}
  }

  /**
   * Formats user message to Gemini's Content format.
   * Handles both simple string content and multimodal content parts.
   */
  private formatUserMessage(msg: InternalMessage): Content {
    const parts: Part[] = []

    if (typeof msg.content === 'string') {
      // Simple text message
      parts.push({text: msg.content})
    } else if (Array.isArray(msg.content)) {
      // Multimodal content (text, images, files)
      for (const part of msg.content) {
        parts.push(this.formatUserContentPart(part))
      }
    }

    return {
      parts,
      role: 'user',
    }
  }

  /**
   * Generates a unique tool call ID.
   * Gemini doesn't provide tool call IDs, so we generate them.
   *
   * @param toolName The name of the tool being called
   * @returns A unique identifier for the tool call
   */
  private generateToolCallId(toolName: string): string {
    // Simple ID generation: timestamp + random + tool name
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 9)
    return `call_${timestamp}_${random}_${toolName}`
  }
}