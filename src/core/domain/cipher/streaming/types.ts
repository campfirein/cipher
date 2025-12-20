import type {ExecutionContext} from '../../../interfaces/cipher/i-cipher-agent.js'
import type {TokenUsage} from '../agent-events/types.js'

/**
 * Streaming event names for CipherAgent.stream()
 * These are the events exposed via the streaming API for real-time chat UIs.
 */
export const STREAMING_EVENT_NAMES = [
  'llmservice:thinking',
  'llmservice:chunk',
  'llmservice:response',
  'llmservice:toolCall',
  'llmservice:toolResult',
  'llmservice:error',
  'llmservice:warning',
  'message:queued',
  'message:dequeued',
  'run:complete',
] as const

export type StreamingEventName = (typeof STREAMING_EVENT_NAMES)[number]

/**
 * Union type of all streaming events with their payloads.
 * Uses 'name' property as discriminant for type narrowing.
 */
export type StreamingEvent =
  | {
      args: Record<string, unknown>
      callId?: string
      name: 'llmservice:toolCall'
      sessionId: string
      toolName: string
    }
  | {
      callId?: string
      error?: string
      name: 'llmservice:toolResult'
      result?: unknown
      sessionId: string
      success: boolean
      toolName: string
    }
  | {
      code?: string
      error: string
      name: 'llmservice:error'
      recoverable?: boolean
      sessionId: string
    }
  | {
      content: string
      isComplete?: boolean
      name: 'llmservice:chunk'
      sessionId: string
      type: 'reasoning' | 'text'
    }
  | {
      content: string
      model?: string
      name: 'llmservice:response'
      partial?: boolean
      provider?: string
      reasoning?: string
      sessionId: string
      tokenUsage?: TokenUsage
    }
  | {
      count: number
      name: 'message:dequeued'
      sessionId: string
    }
  | {
      durationMs: number
      error?: Error
      finishReason: 'cancelled' | 'error' | 'max-iterations' | 'stop' | 'timeout'
      name: 'run:complete'
      sessionId: string
      stepCount: number
    }
  | {
      message: string
      name: 'llmservice:warning'
      sessionId: string
    }
  | {
      message: {content: string; id: string; queuedAt: number}
      name: 'message:queued'
      position: number
      sessionId: string
    }
  | {name: 'llmservice:thinking'; sessionId: string}

/**
 * Options for stream() method
 */
export interface StreamOptions {
  /** Execution context */
  executionContext?: ExecutionContext
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Tracking request ID for backend metrics (random UUID per request, NOT related to session memory) */
  trackingRequestId?: string
}

/**
 * Complete response from generate() method (wrapper around stream)
 */
export interface GenerateResponse {
  /** The final response content */
  content: string
  /** Internal reasoning (if available) */
  reasoning?: string
  /** Session ID */
  sessionId: string
  /** Tool calls made during execution */
  toolCalls: Array<{
    args: Record<string, unknown>
    callId: string
    result?: {data: unknown; success: boolean}
    toolName: string
  }>
  /** Token usage statistics */
  usage: TokenUsage
}
