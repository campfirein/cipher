import type {ExecutionContext} from '../../interfaces/i-cipher-agent.js'
import type {TokenUsage} from '../agent-events/types.js'
import type {ToolErrorType} from '../tools/tool-error.js'

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
      taskId?: string
      toolName: string
    }
  | {
      callId?: string
      error?: string
      errorType?: ToolErrorType
      metadata?: Record<string, unknown>
      name: 'llmservice:toolResult'
      result?: unknown
      sessionId: string
      success: boolean
      taskId?: string
      toolName: string
    }
  | {
      code?: string
      error: string
      name: 'llmservice:error'
      recoverable?: boolean
      sessionId: string
      taskId?: string
    }
  | {
      content: string
      isComplete?: boolean
      name: 'llmservice:chunk'
      sessionId: string
      taskId?: string
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
      taskId?: string
      tokenUsage?: TokenUsage
    }
  | {
      count: number
      name: 'message:dequeued'
      sessionId: string
      taskId?: string
    }
  | {
      durationMs: number
      error?: Error
      finishReason: 'cancelled' | 'error' | 'max-iterations' | 'stop' | 'timeout'
      name: 'run:complete'
      sessionId: string
      stepCount: number
      taskId?: string
    }
  | {
      message: string
      name: 'llmservice:warning'
      sessionId: string
      taskId?: string
    }
  | {
      message: {content: string; id: string; queuedAt: number}
      name: 'message:queued'
      position: number
      sessionId: string
      taskId?: string
    }
  | {name: 'llmservice:thinking'; sessionId: string; taskId?: string}

/**
 * Options for stream() method
 */
export interface StreamOptions {
  /** Execution context */
  executionContext?: ExecutionContext
  /** Session ID override — uses default session if not provided (for per-task session isolation) */
  sessionId?: string
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Task ID for concurrent task isolation (included in all emitted events) */
  taskId?: string
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
    result?: {data: unknown; metadata?: Record<string, unknown>; success: boolean}
    toolName: string
  }>
  /** Token usage statistics */
  usage: TokenUsage
}
