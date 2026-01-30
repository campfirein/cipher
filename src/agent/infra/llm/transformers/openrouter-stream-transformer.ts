/**
 * OpenRouter Stream Transformer
 *
 * Transforms OpenRouter/OpenAI streaming chunks (GenerateContentChunk)
 * into StreamEvent format compatible with StreamProcessor.
 *
 * This follows the OpenCode pattern of delta-based streaming events
 * for real-time UI updates.
 *
 * Supports multiple reasoning extraction methods:
 * 1. Native reasoning fields (OpenAI o1/o3, Grok, Gemini) - via rawChunk
 * 2. Pre-extracted reasoning (from content generator) - via chunk.reasoning
 * 3. <think> tags in content (Claude, DeepSeek, MiniMax) - via tag extraction
 *
 * Following OpenCode's extractReasoningMiddleware pattern.
 */

import type {StreamEvent} from '../stream-processor.js'

import {GenerateContentChunk} from '../../../core/interfaces/i-content-generator.js'
import {getModelCapabilities} from '../model-capabilities.js'
import {extractReasoning} from './reasoning-extractor.js'

/**
 * State for tracking think tag extraction across streaming chunks.
 */
interface ThinkTagState {
  /** Buffer for accumulating content when inside a think tag */
  buffer: string
  /** Whether we're currently inside a <think> tag */
  insideThinkTag: boolean
}

/**
 * Process text content to extract <think> tags and separate reasoning from text.
 * Returns events to emit based on the content analysis.
 *
 * @param content - Raw text content from chunk
 * @param state - Mutable state for tracking think tag parsing across chunks
 * @returns Array of StreamEvents to emit
 */
function processContentForThinkTags(content: string, state: ThinkTagState): StreamEvent[] {
  const events: StreamEvent[] = []
  let remaining = content
  let textBuffer = ''

  while (remaining.length > 0) {
    if (state.insideThinkTag) {
      // Look for closing </think> tag
      const closeIndex = remaining.indexOf('</think>')
      if (closeIndex === -1) {
        // No closing tag yet - buffer everything
        state.buffer += remaining
        remaining = ''
      } else {
        // Found closing tag - emit buffered reasoning
        const reasoningContent = state.buffer + remaining.slice(0, closeIndex)
        if (reasoningContent) {
          events.push({delta: reasoningContent, type: 'reasoning-delta'})
        }

        state.buffer = ''
        state.insideThinkTag = false
        remaining = remaining.slice(closeIndex + 8) // Skip past </think>
      }
    } else {
      // Look for opening <think> tag
      const openIndex = remaining.indexOf('<think>')
      if (openIndex === -1) {
        // No think tag - check for partial tag at end
        // Look for potential start of <think> at the end
        let partialTagLength = 0
        for (let i = 1; i <= Math.min(6, remaining.length); i++) {
          const suffix = remaining.slice(-i)
          if ('<think>'.startsWith(suffix)) {
            partialTagLength = i
          }
        }

        if (partialTagLength > 0) {
          // Buffer the potential partial tag, emit the rest as text
          textBuffer += remaining.slice(0, -partialTagLength)
          state.buffer = remaining.slice(-partialTagLength)
        } else {
          textBuffer += remaining
        }

        remaining = ''
      } else {
        // Found opening tag - emit any text before it
        const textBefore = remaining.slice(0, openIndex)
        if (textBefore) {
          textBuffer += textBefore
        }

        state.insideThinkTag = true
        state.buffer = ''
        remaining = remaining.slice(openIndex + 7) // Skip past <think>
      }
    }
  }

  // Emit accumulated text content
  if (textBuffer) {
    events.push({delta: textBuffer, type: 'text-delta'})
  }

  return events
}

/**
 * Options for stream transformation
 */
export interface TransformOptions {
  /** Model ID for capability detection (e.g., 'openai/o3-mini', 'anthropic/claude-3-opus') */
  modelId?: string
  /** Current step index for step events */
  stepIndex?: number
}

/**
 * Transform GenerateContentChunk stream into StreamEvent stream.
 *
 * Maps the chunk format from OpenRouterContentGenerator to the
 * StreamEvent format expected by StreamProcessor:
 *
 * - content (delta) → { type: 'text-delta', delta } or { type: 'reasoning-delta', delta }
 * - reasoning (native) → { type: 'reasoning-start/delta-v2/end' } (for OpenAI, Grok, Gemini)
 * - toolCalls → { type: 'tool-call-start' }, { type: 'tool-call-input' }
 * - finishReason → { type: 'step-finish', ... }
 * - isComplete → { type: 'finish' }
 *
 * Supports multiple reasoning extraction methods:
 * 1. Native reasoning fields (OpenAI o1/o3, Grok, Gemini) - checked first
 * 2. Pre-extracted reasoning from chunk.reasoning
 * 3. <think> tags in content (Claude, DeepSeek, MiniMax) - fallback
 *
 * @param chunks - Async generator of GenerateContentChunk from content generator
 * @param options - Transform options including modelId for capability detection
 * @yields StreamEvent objects for StreamProcessor
 */
export async function* transformGenerateContentChunksToStreamEvents(
  chunks: AsyncGenerator<GenerateContentChunk>,
  options: TransformOptions = {},
): AsyncGenerator<StreamEvent> {
  const {modelId = '', stepIndex = 0} = options
  const capabilities = getModelCapabilities(modelId)

  // Track tool calls that have been started
  const startedToolCalls = new Set<string>()

  // State for think tag extraction (fallback for think-tags format)
  const thinkState: ThinkTagState = {
    buffer: '',
    insideThinkTag: false,
  }

  // State for native reasoning tracking
  let activeReasoningId: string | undefined
  let reasoningStarted = false

  // Emit step start
  yield {
    stepIndex,
    type: 'step-start',
  }

  for await (const chunk of chunks) {
    let reasoningHandled = false

    // Priority 1: Check for native reasoning in rawChunk (for models with native-field format)
    if (capabilities.reasoningFormat === 'native-field' && chunk.rawChunk) {
      const reasoningResult = extractReasoning(chunk.rawChunk, modelId)

      if (reasoningResult.reasoning) {
        reasoningHandled = true
        // Emit reasoning-start if this is the first reasoning chunk
        if (!reasoningStarted && reasoningResult.reasoningId) {
          activeReasoningId = reasoningResult.reasoningId
          reasoningStarted = true
          yield {
            id: activeReasoningId,
            providerMetadata: reasoningResult.providerMetadata,
            type: 'reasoning-start',
          }
        }

        // Emit reasoning delta (using v2 format with ID tracking)
        yield {
          delta: reasoningResult.reasoning,
          id: activeReasoningId ?? `reasoning-${Date.now()}`,
          providerMetadata: reasoningResult.providerMetadata,
          type: 'reasoning-delta-v2',
        }
      }

      // Handle any text content extracted alongside reasoning
      if (reasoningResult.content) {
        yield {delta: reasoningResult.content, type: 'text-delta'}
      }
    }

    // Priority 2: Check for pre-extracted reasoning in chunk (only if Priority 1 didn't handle it)
    if (!reasoningHandled && chunk.reasoning) {
      // Emit reasoning-start if this is the first reasoning chunk
      if (!reasoningStarted) {
        activeReasoningId = chunk.reasoningId ?? `reasoning-${Date.now()}`
        reasoningStarted = true
        yield {
          id: activeReasoningId,
          providerMetadata: chunk.providerMetadata,
          type: 'reasoning-start',
        }
      }

      // Emit reasoning delta
      yield {
        delta: chunk.reasoning,
        id: activeReasoningId ?? `reasoning-${Date.now()}`,
        providerMetadata: chunk.providerMetadata,
        type: 'reasoning-delta-v2',
      }
    }

    // Priority 3: Handle text content - extract <think> tags for think-tags format
    if (chunk.content) {
      if (capabilities.reasoningFormat === 'think-tags') {
        // Extract <think> tags for models that use them
        const events = processContentForThinkTags(chunk.content, thinkState)
        for (const event of events) {
          yield event
        }
      } else if (capabilities.reasoningFormat !== 'native-field') {
        // For models without reasoning or already handled natively, emit as text
        yield {delta: chunk.content, type: 'text-delta'}
      } else if (!chunk.rawChunk) {
        // Native format but no rawChunk - fall back to think tag extraction
        const events = processContentForThinkTags(chunk.content, thinkState)
        for (const event of events) {
          yield event
        }
      }
    }

    // Handle tool calls on final chunk
    if (chunk.toolCalls && chunk.toolCalls.length > 0) {
      for (const toolCall of chunk.toolCalls) {
        const callId = toolCall.id

        // Emit tool-call-start if not already started
        if (!startedToolCalls.has(callId)) {
          startedToolCalls.add(callId)
          yield {
            callId,
            toolName: toolCall.function.name,
            type: 'tool-call-start',
          }
        }

        // Emit tool-call-input with parsed arguments
        try {
          const input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
          yield {
            callId,
            input,
            type: 'tool-call-input',
          }
        } catch {
          // If arguments can't be parsed, emit empty input
          yield {
            callId,
            input: {},
            type: 'tool-call-input',
          }
        }
      }
    }

    // Handle completion
    if (chunk.isComplete) {
      // Flush any remaining buffered content
      if (thinkState.buffer) {
        // Emit as reasoning if inside think tag, otherwise as text
        yield thinkState.insideThinkTag
          ? {delta: thinkState.buffer, type: 'reasoning-delta' as const}
          : {delta: thinkState.buffer, type: 'text-delta' as const}

        thinkState.buffer = ''
      }

      // Emit reasoning-end if we had active reasoning
      if (reasoningStarted && activeReasoningId) {
        yield {
          id: activeReasoningId,
          providerMetadata: chunk.providerMetadata,
          type: 'reasoning-end',
        }
      }

      // Emit step finish with finish reason
      const finishReason =
        chunk.finishReason === 'tool_calls' ? 'tool_calls' : chunk.finishReason === 'max_tokens' ? 'max_tokens' : 'stop'

      yield {
        cost: 0, // Cost calculated separately
        finishReason,
        stepIndex,
        tokens: {
          input: 0, // Tokens updated after stream completes
          output: 0,
        },
        type: 'step-finish',
      }

      // Emit finish event
      yield {
        type: 'finish',
      }
    }
  }
}
