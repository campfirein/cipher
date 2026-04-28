/**
 * Hook that subscribes the tasks Zustand store to transport events.
 * Call this once from a top-level component to wire up task lifecycle events.
 */

import type {
  LlmChunk,
  LlmResponse,
  LlmToolCall,
  LlmToolResult,
  TaskCompleted,
  TaskCreated,
  TaskErrorData,
  TaskStarted,
} from '@campfirein/brv-transport-client'

import {useEffect} from 'react'

import type {ReviewNotifyEvent} from '../../../../shared/transport/events/review-events.js'

import {ReviewEvents} from '../../../../shared/transport/events/review-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {useTasksStore} from '../stores/tasks-store.js'

export function useTaskSubscriptions(): void {
  const client = useTransportStore((s) => s.client)

  useEffect(() => {
    if (!client) return

    const store = useTasksStore.getState()
    const unsubscribers: Array<() => void> = []

    unsubscribers.push(
      client.on<TaskCreated>('task:created', (data) => {
        store.createTask(data.taskId, data.type, data.content, data.files)
      }),

      client.on<TaskStarted>('task:started', (data) => {
        store.setStarted(data.taskId)
      }),

      client.on<TaskCompleted>('task:completed', (data) => {
        store.setCompleted(data.taskId, data.result)
      }),

      client.on<{error: TaskErrorData; taskId: string}>('task:error', (data) => {
        store.setError(data.taskId, data.error)
      }),

      client.on<{taskId: string}>('task:cancelled', (data) => {
        store.setCancelled(data.taskId)
      }),

      // task:deleted is broadcast by the daemon when ANY client (this TUI, the
      // WebUI, or another tab) removes a task via task:delete /
      // task:deleteBulk / task:clearCompleted. Drop the row locally so all
      // surfaces stay in sync without polling.
      client.on<{taskId: string}>('task:deleted', (data) => {
        store.removeTask(data.taskId)
      }),

      client.on<LlmToolCall>('llmservice:toolCall', (data) => {
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

      client.on<LlmToolResult>('llmservice:toolResult', (data) => {
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

      client.on<LlmResponse>('llmservice:response', (data) => {
        if (!data.taskId) return
        store.setResponse(data.taskId, data.content, data.sessionId)
      }),

      client.on<{taskId: string}>('llmservice:thinking', (data) => {
        store.addReasoningContent(data.taskId, {
          content: '',
          isThinking: true,
          timestamp: Date.now(),
        })
      }),

      client.on<LlmChunk>('llmservice:chunk', (data) => {
        if (!data.taskId) return
        store.appendStreamingContent({
          content: data.content,
          isComplete: data.isComplete ?? false,
          sessionId: data.sessionId,
          taskId: data.taskId,
          type: data.type === 'reasoning' ? 'reasoning' : 'text',
        })
      }),

      client.on<ReviewNotifyEvent>(ReviewEvents.NOTIFY, (data) => {
        if (data.pendingCount === 0) {
          store.clearReviewNotification(data.taskId)
        } else {
          store.setReviewNotification(data.taskId, {
            pendingCount: data.pendingCount,
            reviewUrl: data.reviewUrl,
          })
        }
      }),
    )

    return () => {
      for (const unsub of unsubscribers) unsub()
    }
  }, [client])
}
