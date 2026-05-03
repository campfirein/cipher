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
 * Pass `signal` to abort the wait and release listeners early when the
 * caller has already failed (e.g. task:create rejected before the task
 * was queued, so completion events will never fire).
 *
 * Listens for:
 * - llmservice:response: Captures the LLM's text response
 * - task:completed: Task finished successfully
 * - task:error: Task failed with an error
 */
export async function waitForTaskResult(
  client: ITransportClient,
  taskId: string,
  timeoutMs: number = 300_000, // 5 minutes (increased from 2 minutes to accommodate sub-agent tasks)
  signal?: AbortSignal,
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

      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }

    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true
        cleanup()
        reject(new Error(`Task timeout after ${timeoutMs}ms`))
      }
    }, timeoutMs)

    const onAbort = signal
      ? (): void => {
          if (!completed) {
            completed = true
            cleanup()
            reject(new Error('Task wait aborted'))
          }
        }
      : undefined

    if (signal && onAbort) {
      if (signal.aborted) {
        completed = true
        clearTimeout(timeout)
        reject(new Error('Task wait aborted'))
        return
      }

      signal.addEventListener('abort', onAbort, {once: true})
    }

    unsubscribers.push(
      client.onStateChange((state) => {
        if (state === 'disconnected' && !completed) {
          completed = true
          cleanup()
          reject(new Error('Connection lost to the daemon'))
        }
      }),
      client.on<LlmResponsePayload>(LlmEventNames.RESPONSE, (payload) => {
        if (payload.taskId === taskId && payload.content) {
          result = payload.content
        }
      }),
      client.on<TaskCompletedPayload>(TransportTaskEventNames.COMPLETED, (payload) => {
        if (payload.taskId === taskId && !completed) {
          completed = true
          cleanup()
          resolve(payload.result || result)
        }
      }),
      client.on<TaskErrorPayload>(TransportTaskEventNames.ERROR, (payload) => {
        if (payload.taskId === taskId && !completed) {
          completed = true
          cleanup()
          reject(new Error(payload.error.message))
        }
      }),
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
