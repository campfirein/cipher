/**
 * Local task shape held in the web UI store. Wraps `TaskListItem` (the wire
 * type from `task:list`) with the rich event data captured from
 * `llmservice:*` broadcasts — tool calls, reasoning, streaming response.
 *
 * Mirrors the TUI's tasks-store `Task` shape so both UIs share the mental model.
 */

import type {ReasoningContentItem, TaskListItem, ToolCallEvent} from '../../../../shared/transport/events/task-events'

export type {ReasoningContentItem, ToolCallEvent} from '../../../../shared/transport/events/task-events'

export interface StoredTask extends TaskListItem {
  isStreaming?: boolean
  reasoningContents?: ReasoningContentItem[]
  /** Set when the agent's response stream resolves (final assistant message). */
  responseContent?: string
  sessionId?: string
  streamingContent?: string
  toolCalls?: ToolCallEvent[]
}
