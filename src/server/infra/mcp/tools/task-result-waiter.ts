import type {ITransportClient} from '@campfirein/brv-transport-client'

import {LlmEventNames, TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'

export interface TaskCompletedPayload {
  result: string
  taskId: string
}

export interface TaskErrorPayload {
  error: {
    code?: string
    details?: Record<string, unknown>
    message: string
    name: string
  }
  taskId: string
}

export interface LlmResponsePayload {
  content: string
  taskId: string
}

/**
 * Waits for a task to complete and returns the result.
 *
 * Unlike the fire-and-forget pattern used by `brv curate`, MCP tools need
 * to wait for the task to finish and return the result to the coding agent.
 *
 * This function listens for:
 * - llmservice:response: Captures the LLM's text response
 * - task:completed: Task finished successfully
 * - task:error: Task failed with an error
 */
export async function waitForTaskResult(
  client: ITransportClient,
  taskId: string,
  timeoutMs: number = 300_000, // 5 minutes (increased from 2 minutes to accommodate sub-agent tasks)
): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = ''
    let completed = false
    const unsubscribers: Array<() => void> = []

    const cleanup = (): void => {
      clearTimeout(timeout)
      for (const unsub of unsubscribers) {
        unsub()
      }
    }

    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true
        cleanup()
        reject(new Error(`Task timeout after ${timeoutMs}ms`))
      }
    }, timeoutMs)

    // Set up all event listeners
    unsubscribers.push(
      // Listen for connection state changes - fail fast on disconnect
      client.onStateChange((state) => {
        if (state === 'disconnected' && !completed) {
          completed = true
          cleanup()
          reject(new Error('Connection lost to ByteRover instance'))
        }
      }),
      // Listen for LLM response content
      client.on<LlmResponsePayload>(LlmEventNames.RESPONSE, (payload) => {
        if (payload.taskId === taskId && payload.content) {
          result = payload.content
        }
      }),
      // Listen for task completion
      client.on<TaskCompletedPayload>(TransportTaskEventNames.COMPLETED, (payload) => {
        if (payload.taskId === taskId && !completed) {
          completed = true
          cleanup()
          // Use the result from the event if available, otherwise use accumulated result
          resolve(payload.result || result)
        }
      }),
      // Listen for task error
      client.on<TaskErrorPayload>(TransportTaskEventNames.ERROR, (payload) => {
        if (payload.taskId === taskId && !completed) {
          completed = true
          cleanup()
          reject(new Error(payload.error.message))
        }
      }),
      // Listen for task cancellation
      client.on<{taskId: string}>(TransportTaskEventNames.CANCELLED, (payload) => {
        if (payload.taskId === taskId && !completed) {
          completed = true
          cleanup()
          reject(new Error('Task was cancelled'))
        }
      }),
    )
  })
}
