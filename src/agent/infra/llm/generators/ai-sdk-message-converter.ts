/**
 * AI SDK Message Converter
 *
 * Converts between internal message format and AI SDK's ModelMessage format.
 * System messages are excluded — passed separately via the `system` parameter.
 */

import type {ModelMessage} from 'ai'

import {tool as aiSdkTool, jsonSchema} from 'ai'

import type {ToolSet as InternalToolSet} from '../../../core/domain/tools/types.js'
import type {InternalMessage} from '../../../core/interfaces/message-types.js'

/**
 * Synthetic thought signature that bypasses Gemini 3+ validation.
 * Used as fallback when real thoughtSignature is not available.
 */
const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

/**
 * Convert internal messages to AI SDK ModelMessage format.
 * System messages are filtered out — they are passed via the `system` param.
 */
export function toModelMessages(messages: InternalMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      continue
    }

    switch (msg.role) {
      case 'assistant': {
        const converted = convertAssistantMessage(msg)
        if (converted) {
          result.push(converted)
        }

        break
      }

      case 'tool': {
        appendToolResult(result, msg)

        break
      }

      case 'user': {
        const converted = convertUserMessage(msg)
        if (converted) {
          result.push(converted)
        }

        break
      }
    }
  }

  return result
}

/**
 * Convert our ToolSet to AI SDK tool definitions.
 * Tools are declared without `execute` — our agentic loop handles execution.
 *
 * The last tool gets `providerOptions.anthropic.cacheControl: ephemeral`,
 * which makes Anthropic cache the entire tool block (and the system prompt
 * before it). Non-Anthropic providers ignore the `anthropic` namespace.
 */
export function toAiSdkTools(tools?: InternalToolSet): Record<string, ReturnType<typeof aiSdkTool>> | undefined {
  if (!tools || Object.keys(tools).length === 0) {
    return undefined
  }

  const entries = Object.entries(tools)
  const result: Record<string, ReturnType<typeof aiSdkTool>> = {}

  for (const [index, [name, def]] of entries.entries()) {
    const isLast = index === entries.length - 1
    result[name] = aiSdkTool({
      description: def.description ?? '',
      inputSchema: jsonSchema(def.parameters as Record<string, unknown>),
      ...(isLast && {providerOptions: {anthropic: {cacheControl: {type: 'ephemeral'}}}}),
    })
  }

  return result
}

/**
 * Extract text from an InternalMessage's content field.
 */
function extractTextContent(msg: InternalMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content
  }

  if (!Array.isArray(msg.content)) {
    return ''
  }

  return msg.content
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}

/**
 * Convert an internal user message to AI SDK format.
 * Handles text, image, and file content parts.
 */
function convertUserMessage(msg: InternalMessage): ModelMessage | undefined {
  if (Array.isArray(msg.content)) {
    type UserPart =
      | {data: string | URL; mediaType: string; type: 'file'}
      | {image: string | URL; mediaType?: string; type: 'image'}
      | {text: string; type: 'text'}

    const parts: UserPart[] = []

    for (const part of msg.content) {
      switch (part.type) {
        case 'file': {
          parts.push({
            data: part.data as string | URL,
            mediaType: part.mimeType,
            type: 'file',
          })

          break
        }

        case 'image': {
          parts.push({
            image: part.image as string | URL,
            type: 'image',
            ...(part.mimeType && {mediaType: part.mimeType}),
          })

          break
        }

        case 'text': {
          parts.push({text: part.text, type: 'text'})

          break
        }

        default: {
          break
        }
      }
    }

    if (parts.length === 0) {
      return undefined
    }

    return {content: parts, role: 'user'} as ModelMessage
  }

  const text = typeof msg.content === 'string' ? msg.content : ''
  if (!text) {
    return undefined
  }

  return {content: text, role: 'user'}
}

/**
 * Convert an internal assistant message to AI SDK format.
 * Handles reasoning, text content, and tool calls.
 *
 * The reasoning part is required when the message is replayed to providers
 * that demand the previous turn's thinking trace round-trip back — DeepSeek-R1
 * rejects requests with "The reasoning_content in the thinking mode must be
 * passed back to the API" if the assistant message in history lacks the
 * reasoning that was emitted on the prior turn.
 */
function convertAssistantMessage(msg: InternalMessage): ModelMessage | undefined {
  const textContent = extractTextContent(msg)
  const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0
  const hasReasoning = Boolean(msg.reasoning)

  if (!textContent && !hasToolCalls && !hasReasoning) {
    return undefined
  }

  // Simple text-only case (no reasoning, no tools)
  if (textContent && !hasToolCalls && !hasReasoning) {
    return {content: textContent, role: 'assistant'}
  }

  // Build mixed content array (reasoning + text + tool calls)
  type AssistantPart =
    | {input: unknown; providerOptions?: Record<string, Record<string, unknown>>; toolCallId: string; toolName: string; type: 'tool-call'}
    | {text: string; type: 'reasoning'}
    | {text: string; type: 'text'}

  const parts: AssistantPart[] = []

  // Reasoning must come first — providers that consume it expect it at the
  // start of the assistant turn, before any text/tool-call output.
  if (msg.reasoning) {
    parts.push({text: msg.reasoning, type: 'reasoning'})
  }

  if (textContent) {
    parts.push({text: textContent, type: 'text'})
  }

  for (const tc of msg.toolCalls ?? []) {
    let input: unknown
    try {
      input = JSON.parse(tc.function.arguments)
    } catch {
      input = {}
    }

    // Gemini 3+ models require thoughtSignature on function call parts.
    // Use real signature if available, fall back to synthetic validator skip.
    const thoughtSig = tc.thoughtSignature || SYNTHETIC_THOUGHT_SIGNATURE

    parts.push({
      input,
      providerOptions: {google: {thoughtSignature: thoughtSig}},
      toolCallId: tc.id,
      toolName: tc.function.name,
      type: 'tool-call',
    })
  }

  return {content: parts, role: 'assistant'} as ModelMessage
}

/**
 * Append a tool result to the message list, merging consecutive tool results.
 */
function appendToolResult(result: ModelMessage[], msg: InternalMessage): void {
  const toolResultContent = typeof msg.content === 'string' ? msg.content : extractTextContent(msg)
  const toolResult = {
    output: {type: 'text' as const, value: toolResultContent},
    toolCallId: msg.toolCallId ?? '',
    toolName: msg.name ?? '',
    type: 'tool-result' as const,
  }

  // Merge consecutive tool results into one tool message
  const lastMsg = result.at(-1)
  if (lastMsg && lastMsg.role === 'tool' && Array.isArray(lastMsg.content)) {
    ;(lastMsg.content as unknown as Array<typeof toolResult>).push(toolResult)
  } else {
    result.push({content: [toolResult], role: 'tool'} as unknown as ModelMessage)
  }
}
