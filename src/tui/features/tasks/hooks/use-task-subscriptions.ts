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
    )

    return () => {
      for (const unsub of unsubscribers) unsub()
    }
  }, [client])
}
