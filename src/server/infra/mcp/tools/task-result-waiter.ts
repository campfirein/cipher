import type {ITransportClient} from '../../../core/interfaces/transport/index.js'

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
  timeoutMs: number = 120_000,
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
      client.on<LlmResponsePayload>('llmservice:response', (payload) => {
        if (payload.taskId === taskId && payload.content) {
          result = payload.content
        }
      }),
      // Listen for task completion
      client.on<TaskCompletedPayload>('task:completed', (payload) => {
        if (payload.taskId === taskId && !completed) {
          completed = true
          cleanup()
          // Use the result from the event if available, otherwise use accumulated result
          resolve(payload.result || result)
        }
      }),
      // Listen for task error
      client.on<TaskErrorPayload>('task:error', (payload) => {
        if (payload.taskId === taskId && !completed) {
          completed = true
          cleanup()
          reject(new Error(payload.error.message))
        }
      }),
    )
  })
}
