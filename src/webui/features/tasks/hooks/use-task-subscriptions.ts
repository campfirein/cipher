/**
 * Subscribe the tasks store to the daemon's task lifecycle events plus the
 * `llmservice:*` event stream that carries reasoning, tool calls, and
 * streaming response chunks.
 *
 * Mirrors src/tui/features/tasks/hooks/use-task-subscriptions.ts.
 */

import {useEffect} from 'react'

import {TaskEvents} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'
import {useTaskStore} from '../stores/task-store'

interface TaskCreatedPayload {
  content: string
  files?: string[]
  folderPath?: string
  taskId: string
  type: string
}

interface TaskStartedPayload {
  taskId: string
}

interface TaskCompletedPayload {
  result: string
  taskId: string
}

interface TaskErrorPayload {
  error: {
    code?: string
    message: string
    name?: string
  }
  taskId: string
}

interface TaskCancelledPayload {
  taskId: string
}

interface LlmToolCallPayload {
  args: Record<string, unknown>
  callId?: string
  sessionId: string
  taskId?: string
  toolName: string
}

interface LlmToolResultPayload {
  callId?: string
  error?: string
  errorType?: string
  result?: unknown
  success: boolean
  taskId?: string
  toolName: string
}

interface LlmChunkPayload {
  content: string
  isComplete?: boolean
  sessionId?: string
  taskId?: string
  type?: string
}

interface LlmResponsePayload {
  content: string
  sessionId?: string
  taskId?: string
}

interface LlmThinkingPayload {
  taskId?: string
}

const LLM_EVENTS = {
  CHUNK: 'llmservice:chunk',
  RESPONSE: 'llmservice:response',
  THINKING: 'llmservice:thinking',
  TOOL_CALL: 'llmservice:toolCall',
  TOOL_RESULT: 'llmservice:toolResult',
} as const

export function useTaskSubscriptions(): void {
  const apiClient = useTransportStore((s) => s.apiClient)

  useEffect(() => {
    if (!apiClient) return
    const store = useTaskStore.getState()
    const unsubscribers: Array<() => void> = []

    unsubscribers.push(
      apiClient.on<TaskCreatedPayload>(TaskEvents.CREATED, (data) => {
        store.upsertStatus(data.taskId, {
          content: data.content,
          createdAt: Date.now(),
          ...(data.files?.length ? {files: data.files} : {}),
          ...(data.folderPath ? {folderPath: data.folderPath} : {}),
          status: 'created',
          type: data.type,
        })
      }),

      apiClient.on<TaskStartedPayload>(TaskEvents.STARTED, (data) => {
        store.upsertStatus(data.taskId, {startedAt: Date.now(), status: 'started'})
      }),

      apiClient.on<TaskCompletedPayload>(TaskEvents.COMPLETED, (data) => {
        store.upsertStatus(data.taskId, {
          completedAt: Date.now(),
          result: data.result,
          status: 'completed',
        })
      }),

      apiClient.on<TaskErrorPayload>(TaskEvents.ERROR, (data) => {
        store.upsertStatus(data.taskId, {
          completedAt: Date.now(),
          error: data.error,
          status: 'error',
        })
      }),

      apiClient.on<TaskCancelledPayload>(TaskEvents.CANCELLED, (data) => {
        store.upsertStatus(data.taskId, {
          completedAt: Date.now(),
          status: 'cancelled',
        })
      }),

      apiClient.on<LlmToolCallPayload>(LLM_EVENTS.TOOL_CALL, (data) => {
        if (!data.taskId) return
        store.addToolCall(data.taskId, {
          args: data.args,
          callId: data.callId,
          sessionId: data.sessionId,
          status: 'running',
          timestamp: Date.now(),
          toolName: data.toolName,
        })
      }),

      apiClient.on<LlmToolResultPayload>(LLM_EVENTS.TOOL_RESULT, (data) => {
        if (!data.taskId) return
        store.updateToolCallResult({
          callId: data.callId,
          error: data.error,
          errorType: data.errorType,
          result: data.result,
          success: data.success,
          taskId: data.taskId,
          toolName: data.toolName,
        })
      }),

      apiClient.on<LlmChunkPayload>(LLM_EVENTS.CHUNK, (data) => {
        if (!data.taskId) return
        store.appendStreamingContent({
          content: data.content,
          isComplete: data.isComplete ?? false,
          sessionId: data.sessionId,
          taskId: data.taskId,
          type: data.type === 'reasoning' ? 'reasoning' : 'text',
        })
      }),

      apiClient.on<LlmResponsePayload>(LLM_EVENTS.RESPONSE, (data) => {
        if (!data.taskId) return
        store.setResponse(data.taskId, data.content, data.sessionId)
      }),

      apiClient.on<LlmThinkingPayload>(LLM_EVENTS.THINKING, (data) => {
        if (!data.taskId) return
        store.addReasoningContent(data.taskId, {
          content: '',
          isThinking: true,
          timestamp: Date.now(),
        })
      }),
    )

    return () => {
      for (const unsub of unsubscribers) unsub()
    }
  }, [apiClient])
}
