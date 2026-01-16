import type { Content, FunctionCall, GenerateContentResponse, Part } from '@google/genai'

import type { IMessageFormatter } from '../../../../core/interfaces/cipher/i-message-formatter.js'
import type { InternalMessage, MessagePart, ToolCall } from '../../../../core/interfaces/cipher/message-types.js'

import { isGemini3Model, SYNTHETIC_THOUGHT_SIGNATURE } from '../thought-parser.js'

/**
 * Extended Part type that includes thoughtSignature for Gemini 3+ models.
 * This property is not part of the official @google/genai types but is
 * required for proper function call handling in Gemini 3+ preview models.
 */
interface PartWithThoughtSignature extends Part {
  thoughtSignature?: string
}

/**
 * Type guard to check if a part has a thoughtSignature property.
 */
function hasThoughtSignature(part: Part): part is PartWithThoughtSignature {
  return 'thoughtSignature' in part
}

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
        parts: [{ text: `System: ${systemPrompt}` }],
        role: 'user',
      })
    }

    // Accumulator for consecutive tool results
    let toolGroup: InternalMessage[] = []

    for (const msg of history) {
      if (msg.role === 'tool') {
        // Accumulate tool results
        toolGroup.push(msg)
      } else {
        // Flush accumulated tool results before processing non-tool message
        if (toolGroup.length > 0) {
          contents.push(this.combineToolResults(toolGroup))
          toolGroup = []
        }

        // Format non-tool message
        contents.push(this.formatNonToolMessage(msg))
      }
    }

    // Flush any remaining tool results
    if (toolGroup.length > 0) {
      contents.push(this.combineToolResults(toolGroup))
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
    const functionCallsWithSignatures: Array<{ fc: FunctionCall; thoughtSignature?: string }> = []

    // Extract text and function calls from response parts
    for (const part of candidate.content.parts) {
      if ('text' in part && part.text) {
        textParts.push(part.text)
      }

      if ('functionCall' in part && part.functionCall) {
        // Extract thoughtSignature if present (Gemini 3+ models)
        const thoughtSignature = hasThoughtSignature(part) ? part.thoughtSignature : undefined
        functionCallsWithSignatures.push({
          fc: part.functionCall,
          thoughtSignature,
        })
      }
    }

    // Convert to internal message format
    const toolCalls: ToolCall[] | undefined =
      functionCallsWithSignatures.length > 0
        ? functionCallsWithSignatures.map(({ fc, thoughtSignature }) => ({
          function: {
            arguments: JSON.stringify(fc.args ?? {}),
            name: fc.name ?? '',
          },
          id: this.generateToolCallId(fc.name ?? ''),
          thoughtSignature,
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
   * Combines multiple tool results into a single Gemini user message.
   * Required by Gemini API when assistant made multiple tool calls.
   */
  private combineToolResults(toolMessages: InternalMessage[]): Content {
    const parts: Part[] = []

    for (const msg of toolMessages) {
      // Add the tool result part
      parts.push(this.formatToolResultPart(msg))

      // Extract image/file parts from MessagePart[] content
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image' || part.type === 'file') {
            parts.push(this.formatUserContentPart(part))
          }
        }
      }
    }

    return {
      parts,
      role: 'user',
    }
  }

  /**
   * Formats assistant message to Gemini's Content format.
   * Maps 'assistant' role to 'model' and includes both text and tool calls.
   * For Gemini 3+ models, includes thoughtSignature on function calls.
   */
  private formatAssistantMessage(msg: InternalMessage): Content {
    const parts: Part[] = []

    // Add text content if present
    if (msg.content) {
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text })
          }
        }
      }
    }

    // Add tool calls if present
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const functionCallPart: PartWithThoughtSignature = {
          functionCall: {
            args: JSON.parse(tc.function.arguments),
            name: tc.function.name,
          },
        }

        // Include thoughtSignature if present (required for Gemini 3+ models)
        if (tc.thoughtSignature) {
          functionCallPart.thoughtSignature = tc.thoughtSignature
        }

        parts.push(functionCallPart)
      }
    }

    return {
      parts,
      role: 'model', // Gemini uses 'model' instead of 'assistant'
    }
  }

  /**
   * Formats a single non-tool message to Gemini Content.
   */
  private formatNonToolMessage(msg: InternalMessage): Content {
    switch (msg.role) {
      case 'assistant': {
        return this.formatAssistantMessage(msg)
      }

      case 'system': {
        return {
          parts: [{ text: `System: ${String(msg.content || '')}` }],
          role: 'user',
        }
      }

      case 'user': {
        return this.formatUserMessage(msg)
      }

      default: {
        return {
          parts: [{ text: String(msg.content || '') }],
          role: 'user',
        }
      }
    }
  }

  /**
   * Formats a single tool result message to a Gemini functionResponse Part.
   * Multiple tool results are combined into a single user message by format().
   *
   * Note: msg.content is a JSON string from ToolOutputProcessor.
   * We need to parse it back to an object for Gemini's API.
   */
  private formatToolResultPart(msg: InternalMessage): Part {
    // msg.content is a JSON string from ToolOutputProcessor
    // Parse it back to object for Gemini's API
    let responseObject: Record<string, unknown>

    try {
      // Try to parse as JSON
      if (typeof msg.content === 'string') {
        responseObject = JSON.parse(msg.content) as Record<string, unknown>
      } else if (msg.content === null) {
        responseObject = { result: null }
      } else if (Array.isArray(msg.content)) {
        // Array content (e.g., MessagePart[]) - filter out file/image parts
        // File/image parts are sent separately as inlineData to avoid duplicate tokenization
        const textParts = msg.content.filter((p) => p.type === 'text')
        responseObject = textParts.length > 0 ? { result: textParts } : { result: 'Attachment processed' }
      } else if (typeof msg.content === 'object') {
        // Already an object (shouldn't happen with current implementation, but handle it)
        responseObject = msg.content as Record<string, unknown>
      } else {
        // Primitive types - wrap them
        responseObject = { result: msg.content }
      }
    } catch {
      // If parsing fails, wrap the string as-is
      responseObject = { result: msg.content }
    }

    return {
      functionResponse: {
        name: msg.name ?? '',
        response: responseObject,
      },
    }
  }

  /**
   * Formats a single user content part.
   * Currently supports text parts, with placeholders for image/file support.
   */
  private formatUserContentPart(part: MessagePart): Part {
    if (part.type === 'text') {
      return { text: part.text }
    }

    if (part.type === 'image') {
      // Convert image to Gemini inlineData format
      const imageData = typeof part.image === 'string' ? part.image : String(part.image)
      // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData

      return {
        inlineData: {
          data: base64Data,
          mimeType: part.mimeType ?? 'image/jpeg',
        },
      }
    }

    if (part.type === 'file') {
      // Convert file to Gemini inlineData format (supports PDFs)
      const fileData = typeof part.data === 'string' ? part.data : String(part.data)
      // Remove data URL prefix if present
      const base64Data = fileData.includes(',') ? fileData.split(',')[1] : fileData

      return {
        inlineData: {
          data: base64Data,
          mimeType: part.mimeType ?? 'application/pdf',
        },
      }
    }

    return { text: '[Unknown content type]' }
  }

  /**
   * Formats user message to Gemini's Content format.
   * Handles both simple string content and multimodal content parts.
   */
  private formatUserMessage(msg: InternalMessage): Content {
    const parts: Part[] = []

    if (typeof msg.content === 'string') {
      // Simple text message
      parts.push({ text: msg.content })
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

/**
 * Ensures that function calls in the active conversation loop have thought signatures.
 * Required for Gemini 3+ preview models.
 *
 * The "active loop" starts from the last user text message in the conversation.
 * Only the first function call in each model turn needs a thought signature.
 *
 * @param contents Array of Content objects formatted for Gemini API
 * @param model The model being used (only applies to Gemini 3+ models)
 * @returns Modified contents with thought signatures added where needed
 */
export function ensureActiveLoopHasThoughtSignatures(contents: Content[], model: string): Content[] {
  // Only apply to Gemini 3+ models
  if (!isGemini3Model(model)) {
    return contents
  }

  // Find the last user turn with text message (start of active loop)
  let activeLoopStartIndex = -1
  for (let i = contents.length - 1; i >= 0; i--) {
    const content = contents[i]
    if (content.role === 'user' && content.parts?.some((part) => 'text' in part && part.text)) {
      activeLoopStartIndex = i
      break
    }
  }

  // No user text message found - nothing to do
  if (activeLoopStartIndex === -1) {
    return contents
  }

  // Create shallow copy to avoid mutating original
  const newContents = [...contents]

  // Process each content from active loop start to end
  for (let i = activeLoopStartIndex; i < newContents.length; i++) {
    const content = newContents[i]

    // Only process model turns with parts
    if (content.role !== 'model' || !content.parts) {
      continue
    }

    const newParts = [...content.parts]
    const updatedContent = addThoughtSignatureToFirstFunctionCall(newParts, content)

    if (updatedContent) {
      newContents[i] = updatedContent
    }
  }

  return newContents
}

/**
 * Adds thought signature to the first function call in parts if missing.
 * Returns updated content or null if no modification needed.
 */
function addThoughtSignatureToFirstFunctionCall(parts: Part[], content: Content): Content | null {
  for (let j = 0; j < parts.length; j++) {
    const part = parts[j]

    if (!part || !('functionCall' in part) || !part.functionCall) {
      continue
    }

    // Check if thoughtSignature already exists using type guard
    if (hasThoughtSignature(part) && part.thoughtSignature) {
      return null // Already has signature, no modification needed
    }

    // Add synthetic thought signature
    const partWithSignature: PartWithThoughtSignature = {
      ...part,
      thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
    }
    parts[j] = partWithSignature

    return {
      ...content,
      parts,
    }
  }

  return null // No function call found
}