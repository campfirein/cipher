/**
 * Message and activity log types
 */

import type {ExecutionStatus, ToolCallStatus} from '../../agent/core/domain/queue/types.js'

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
 * Activity log item for displaying in logs view
 */
export interface ActivityLog {
  changes: {created: string[]; updated: string[]}
  content: string
  id: string
  input: string
  progress?: Array<{id: string; status: ToolCallStatus; toolCallName: string}>
  source?: string
  status: ExecutionStatus
  timestamp: Date
  type: 'curate' | 'query'
}
