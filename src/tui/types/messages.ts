/**
 * Message and activity log types
 */

import type {ReasoningContentItem} from '../../shared/transport/events/task-events.js'

/**
 * Status of an execution (curate/query job)
 */
export type ExecutionStatus = 'completed' | 'failed' | 'queued' | 'running'

/**
 * Status of a tool call within an execution
 */
export type ToolCallStatus = 'completed' | 'failed' | 'running'

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
  /** Timestamp when tool call was created */
  timestamp: number
  /** Tool name */
  toolCallName: string
}

export type {ReasoningContentItem} from '../../shared/transport/events/task-events.js'

/**
 * Activity log item for displaying in logs view
 */
export interface ActivityLog {
  changes: {created: string[]; updated: string[]}
  content: string
  /** File references passed via @filepath syntax */
  files?: string[]
  /** Folder references passed via @folderpath syntax */
  folders?: string[]
  id: string
  input: string
  /** Whether LLM is currently streaming response (deprecated, use isReasoningStreaming/isTextStreaming) */
  isStreaming?: boolean
  progress?: ToolProgressItem[]
  /** Accumulated reasoning/thinking content items with timestamps */
  reasoningContents?: ReasoningContentItem[]
  source?: string
  status: ExecutionStatus
  /** Accumulated streaming text content during LLM response */
  streamingContent?: string
  timestamp: Date
  toolCalls?: ToolProgressItem[]
  type: 'curate' | 'curate-folder' | 'query'
}
