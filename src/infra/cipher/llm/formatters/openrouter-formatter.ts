import type {ChatCompletionContentPart, ChatCompletionMessageParam} from 'openai/resources'

import type {IMessageFormatter} from '../../../../core/interfaces/cipher/i-message-formatter.js'
import type {InternalMessage, MessagePart} from '../../../../core/interfaces/cipher/message-types.js'

/**
 * Message formatter for OpenRouter API.
 *
 * OpenRouter uses OpenAI-compatible API format:
 * - System prompts are included in the messages array
 * - Tool calls use the tool_calls property
 * - Tool results use the 'tool' role with tool_call_id
 * - Supports multimodal content (text, images, files)
 */
export class OpenRouterMessageFormatter implements IMessageFormatter<ChatCompletionMessageParam> {
  /**
   * Formats internal messages into OpenRouter's API format (OpenAI-compatible).
   *
   * @param history Array of internal messages to format
   * @param systemPrompt Optional system prompt to include at the beginning
   * @returns Array of messages formatted for OpenRouter's API
   */
  public format(
    history: Readonly<InternalMessage[]>,
    systemPrompt?: null | string,
  ): ChatCompletionMessageParam[] {
    const formatted: ChatCompletionMessageParam[] = []

    // Add system message if provided
    if (systemPrompt) {
      formatted.push({
        content: systemPrompt,
        role: 'system',
      })
    }

    // Track pending tool calls to detect orphans (tool calls without results)
    const pendingToolCallIds = new Set<string>()

    for (const msg of history) {
      switch (msg.role) {
        case 'assistant': {
          // Assistant messages may or may not have tool calls
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            formatted.push({
              content: String(msg.content || ''),
              role: 'assistant',
              // eslint-disable-next-line camelcase
              tool_calls: msg.toolCalls,
            })
            // Track these tool call IDs as pending
            for (const toolCall of msg.toolCalls) {
              pendingToolCallIds.add(toolCall.id)
            }
          } else {
            formatted.push({
              content: String(msg.content || ''),
              role: 'assistant',
            })
          }

          break
        }

        case 'system': {
          // Additional system messages in history
          formatted.push({
            content: String(msg.content || ''),
            role: 'system',
          })
          break
        }

        case 'tool': {
          // Tool results for OpenRouter — only text field is supported.
          // Only add if we've seen the corresponding tool call
          if (msg.toolCallId && pendingToolCallIds.has(msg.toolCallId)) {
            formatted.push({
              content: this.formatToolContent(msg.content),
              role: 'tool',
              // eslint-disable-next-line camelcase
              tool_call_id: msg.toolCallId,
            })
            // Remove from pending since we found its result
            pendingToolCallIds.delete(msg.toolCallId)
          } else {
            // Orphaned tool result (result without matching call)
            // Skip it to prevent API errors
            console.warn(
              `Skipping orphaned tool result ${msg.toolCallId} (no matching tool call found)`,
            )
          }

          break
        }

        case 'user': {
          formatted.push({
            content: this.formatUserContent(msg.content),
            role: 'user',
          })
          break
        }
      }
    }

    // Add synthetic error results for any orphaned tool calls
    // This can happen when the agent crashes/interrupts before tool execution completes
    if (pendingToolCallIds.size > 0) {
      for (const toolCallId of pendingToolCallIds) {
        formatted.push({
          content:
            'Error: Tool execution was interrupted (session crashed or cancelled before completion)',
          role: 'tool',
          // eslint-disable-next-line camelcase
          tool_call_id: toolCallId,
        })
        console.warn(
          `Tool call ${toolCallId} had no matching tool result - added synthetic error result`,
        )
      }
    }

    return formatted
  }

  /**
   * Parses OpenRouter API response into internal message objects.
   *
   * @param response The raw response from OpenRouter API
   * @returns Array of internal messages (typically one assistant message)
   */
  public parseResponse(response: unknown): InternalMessage[] {
    const internal: InternalMessage[] = []
    const typedResponse = response as {choices?: unknown[]}

    if (!typedResponse.choices || !Array.isArray(typedResponse.choices)) {
      return internal
    }

    for (const choice of typedResponse.choices) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (choice as any).message
      if (!msg || !msg.role) continue

      const role = msg.role as InternalMessage['role']

      switch (role) {
        case 'assistant': {
          const content = msg.content ?? null

          // Handle tool calls if present
          if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const calls = msg.tool_calls.map((call: any) => ({
              function: {
                arguments: call.function.arguments,
                name: call.function.name,
              },
              id: call.id,
              type: 'function' as const,
            }))
            internal.push({content, role: 'assistant', toolCalls: calls})
          } else {
            internal.push({content, role: 'assistant'})
          }

          break
        }

        case 'system':
        case 'user': {
          if (msg.content) {
            internal.push({content: msg.content, role})
          }

          break
        }

        case 'tool': {
          internal.push({
            content: msg.content!,
            name: msg.name!,
            role: 'tool',
            toolCallId: msg.tool_call_id!,
          })

          break
        }
      }
    }

    return internal
  }

  /**
   * Formats tool result content to text string.
   * OpenRouter only supports text content for tool messages.
   */
  private formatToolContent(content: InternalMessage['content']): string {
    if (typeof content === 'string') {
      return content
    }

    if (Array.isArray(content)) {
      // Extract text from multimodal content
      return content
        .filter((part) => part.type === 'text')
        .map((part) => (part as {text: string}).text)
        .join('\n')
    }

    return String(content || '')
  }

  /**
   * Formats user message content into OpenRouter's format.
   * Handles both simple string content and multimodal content parts (text, images, files).
   */
  private formatUserContent(
    content: InternalMessage['content'],
  ): ChatCompletionContentPart[] | string {
    if (!Array.isArray(content)) {
      return String(content || '')
    }

    const parts = content
      .map((part): ChatCompletionContentPart | null => this.formatUserContentPart(part))
      .filter((part): part is ChatCompletionContentPart => part !== null)

    return parts
  }

  /**
   * Formats a single user content part (text, image, or file).
   */
  private formatUserContentPart(part: MessagePart): ChatCompletionContentPart | null {
    if (part.type === 'text') {
      return {text: part.text, type: 'text'}
    }

    if (part.type === 'image') {
      // Convert image to data URL or use existing URL
      const imageData = this.getImageData(part.image)
      const url =
        imageData.startsWith('http://') ||
        imageData.startsWith('https://') ||
        imageData.startsWith('data:')
          ? imageData
          : `data:${part.mimeType || 'application/octet-stream'};base64,${imageData}`

      // eslint-disable-next-line camelcase
      return {image_url: {url}, type: 'image_url'}
    }

    if (part.type === 'file') {
      // File support: convert to text representation
      // OpenRouter may support files differently depending on the model
      return {text: `[File: ${part.filename || 'unknown'}]`, type: 'text'}
    }

    return null
  }

  /**
   * Extracts image data as base64 string or URL.
   */
  private getImageData(image: ArrayBuffer | Buffer | string | Uint8Array | URL): string {
    if (typeof image === 'string') {
      return image
    }

    if (image instanceof URL) {
      return image.toString()
    }

    if (image instanceof Buffer) {
      return image.toString('base64')
    }

    if (image instanceof Uint8Array || image instanceof ArrayBuffer) {
      const buffer = image instanceof ArrayBuffer ? new Uint8Array(image) : image
      return Buffer.from(buffer).toString('base64')
    }

    return ''
  }
}
