/**
 * Message and activity log types
 */

import type {ExecutionStatus, ToolCallStatus} from '../../core/domain/cipher/queue/types.js'

/**
 * Message type for displaying in message list
 */
export interface Message {
  content: string
  timestamp?: Date
  type: 'command' | 'error' | 'info' | 'success' | 'system'
}

/**
 * Individual streaming message for real-time output
 */
export interface StreamingMessage {
  /** Action ID for linking action_start with action_stop */
  actionId?: string
  /** Message content */
  content: string
  /** Unique identifier */
  id: string
  /** Tool execution status (for tool_start/tool_end types) */
  status?: 'error' | 'executing' | 'success'
  /** Tool name (for tool_start/tool_end types) */
  toolName?: string
  /** Type of streaming message */
  type: 'action_start' | 'action_stop' | 'error' | 'output' | 'tool_end' | 'tool_start' | 'warning'
}

export interface CommandMessage extends Message {
  fromCommand: string
  /** Streaming output associated with this command */
  output?: StreamingMessage[]
}

/**
 * Tool progress item with parameters for display
 */
export interface ToolProgressItem {
  /** Tool call arguments/parameters */
  args?: Record<string, unknown>
  /** Unique ID for the tool call */
  id: string
  /** Tool execution status */
  status: ToolCallStatus
  /** Tool name */
  toolCallName: string
}

/**
 * Activity log item for displaying in logs view
 */
export interface ActivityLog {
  changes: {created: string[]; updated: string[]}
  content: string
  id: string
  input: string
  /** Whether reasoning/thinking is currently streaming */
  isReasoningStreaming?: boolean
  /** Whether LLM is currently streaming response (deprecated, use isReasoningStreaming/isTextStreaming) */
  isStreaming?: boolean
  /** Whether text content is currently streaming */
  isTextStreaming?: boolean
  progress?: ToolProgressItem[]
  /** Accumulated reasoning/thinking content during LLM response */
  reasoningContent?: string
  source?: string
  status: ExecutionStatus
  /** Accumulated streaming text content during LLM response */
  streamingContent?: string
  timestamp: Date
  type: 'curate' | 'query'
}
