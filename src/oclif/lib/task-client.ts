/**
 * Shared task event subscription utilities for oclif commands.
 *
 * Mirrors TUI's useTaskSubscriptions pattern: subscribes to all task and LLM events,
 * collects tool calls, and streams output in real-time.
 *
 * Used by: curate, query commands.
 */
import type {
  ITransportClient,
  LlmChunk,
  LlmResponse,
  LlmToolCall,
  LlmToolResult,
  TaskCompleted,
  TaskError,
} from '@campfirein/brv-transport-client'

import type {
  QueryLogMatchedDoc,
  QueryLogTier,
} from '../../server/core/domain/entities/query-log-entry.js'

import {TaskErrorCode} from '../../server/core/domain/errors/task-error.js'
import {LlmEvents, TaskEvents} from '../../shared/transport/events/index.js'
import {ReviewEvents, type ReviewNotifyEvent} from '../../shared/transport/events/review-events.js'
import {writeJsonResponse} from './json-response.js'

/**
 * Extends brv-transport-client's TaskCompleted with daemon-merged extras contributed by
 * lifecycle hooks (`getTaskCompletionData`):
 * - `logId` — query/curate log id
 * - `pendingReviewCount` — HITL signal from CurateLogHandler
 * - `matchedDocs`/`tier`/`durationMs`/`topScore` — query recall metadata from QueryLogHandler
 *   (flattened from QueryExecutorResult's nested timing/searchMetadata)
 *
 * All fields are optional — older daemons or non-query tasks omit them.
 */
type TaskCompletedWithLogId = TaskCompleted & {
  durationMs?: number
  logId?: string
  matchedDocs?: QueryLogMatchedDoc[]
  pendingReviewCount?: number
  tier?: QueryLogTier
  topScore?: number
}

/** Extends brv-transport-client's TaskError with logId from ENG-1259 */
type TaskErrorWithLogId = TaskError & {logId?: string}

/** Collected tool call with result (mirrors TUI ToolCallEvent) */
export interface ToolCallRecord {
  args: Record<string, unknown>
  callId?: string
  error?: string
  result?: unknown
  status: 'completed' | 'error' | 'running'
  success?: boolean
  toolName: string
}

/** Completion result passed to onCompleted callback */
export interface TaskCompletionResult {
  /** Wall-clock execution time for query tasks, in milliseconds. Absent for non-query tasks. */
  durationMs?: number
  logId?: string
  /** Documents matched by the query. Empty array on cache hits; absent for non-query tasks. */
  matchedDocs?: QueryLogMatchedDoc[]
  /** Pending review notification from the server, present when review is required after task completion. */
  pendingReview?: {pendingCount: number; reviewUrl: string}
  result?: string
  taskId: string
  /** Resolution tier for query tasks. Absent for non-query tasks. */
  tier?: QueryLogTier
  toolCalls: ToolCallRecord[]
  /** Top compound score across matchedDocs. Absent for cache hits and non-query tasks. */
  topScore?: number
}

/** Error result passed to onError callback */
export interface TaskErrorResult {
  error: {code?: string; message: string}
  logId?: string
  taskId: string
  toolCalls: ToolCallRecord[]
}

/** Options for waitForTaskCompletion */
export interface WaitForTaskOptions {
  /** Client to subscribe events on */
  client: ITransportClient
  /** Command name for JSON output */
  command: string
  /** Output format */
  format: 'json' | 'text'
  /** Called on task:completed */
  onCompleted: (result: TaskCompletionResult) => void
  /** Called on task:error */
  onError: (result: TaskErrorResult) => void
  /** Called on llmservice:response (optional, used by query to display final answer) */
  onResponse?: (content: string, taskId: string) => void
  /** Task ID to wait for */
  taskId: string
  /** Timeout in ms (default: 5 minutes) */
  timeoutMs?: number
}

/** Grace period before treating 'reconnecting' as daemon death (ms) */
const DISCONNECT_GRACE_MS = 10_000
/** Default timeout for task completion (seconds) — shared across curate/query commands. */
export const DEFAULT_TIMEOUT_SECONDS = 300
/** Minimum --timeout value accepted from the CLI (seconds). */
export const MIN_TIMEOUT_SECONDS = 10
/** Maximum --timeout value accepted from the CLI (seconds). */
export const MAX_TIMEOUT_SECONDS = 3600
/** Default timeout for task completion (ms) */
const DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_SECONDS * 1000

/**
 * Format tool call for CLI display (simplified version of TUI formatToolDisplay).
 */
export function formatToolDisplay(toolName: string, args: Record<string, unknown>): string {
  switch (toolName.toLowerCase()) {
    case 'bash': {
      const cmd = args.command ? String(args.command) : ''
      return `Bash ${cmd.length > 60 ? `$ ${cmd.slice(0, 57)}...` : `$ ${cmd}`}`
    }

    case 'code_exec': {
      return 'CodeExec'
    }

    case 'edit': {
      const filePath = args.file_path ?? args.filePath
      return filePath ? `Edit ${filePath}` : 'Edit'
    }

    case 'glob': {
      const {path, pattern} = args
      return pattern ? `Glob "${pattern}"${path ? ` in ${path}` : ''}` : 'Glob'
    }

    case 'grep': {
      const {path, pattern} = args
      return pattern ? `Grep "${pattern}"${path ? ` in ${path}` : ''}` : 'Grep'
    }

    case 'read': {
      const filePath = args.file_path ?? args.filePath
      return filePath ? `Read ${filePath}` : 'Read'
    }

    case 'write': {
      const filePath = args.file_path ?? args.filePath
      return filePath ? `Write ${filePath}` : 'Write'
    }

    default: {
      return toolName
    }
  }
}

/**
 * Wait for task completion by subscribing to all events (same as TUI useTaskSubscriptions).
 * In text mode: streams tool calls and thinking in real-time via log().
 * In JSON mode: streams each event as a separate JSON line.
 *
 * Rejects with a retryable error (AGENT_DISCONNECTED) on daemon disconnect,
 * allowing withDaemonRetry to handle reconnection.
 */
export function waitForTaskCompletion(options: WaitForTaskOptions, log: (msg: string) => void): Promise<void> {
  const {client, command, format, onCompleted, onError, onResponse, taskId, timeoutMs = DEFAULT_TIMEOUT_MS} = options
  const isText = format === 'text'

  return new Promise((resolve, reject) => {
    let completed = false
    let disconnectTimer: NodeJS.Timeout | undefined
    const toolCalls: ToolCallRecord[] = []
    let pendingReview: undefined | {pendingCount: number; reviewUrl: string}

    const rejectRetryable = (message: string): void => {
      if (completed) return
      completed = true
      cleanup()
      reject(Object.assign(new Error(message), {code: TaskErrorCode.AGENT_DISCONNECTED}))
    }

    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true
        cleanup()
        const timeoutMessage = `Task timed out after ${timeoutMs / 1000}s`
        if (isText) {
          reject(new Error(timeoutMessage))
        } else {
          writeJsonResponse({
            command,
            data: {event: 'error', message: timeoutMessage, status: 'error'},
            success: false,
          })
          resolve()
        }
      }
    }, timeoutMs)

    const unsubscribers = [
      // Tool call started (same as TUI addToolCall)
      client.on<LlmToolCall>(LlmEvents.TOOL_CALL, (data) => {
        if (!data.taskId) return
        toolCalls.push({
          args: data.args,
          callId: data.callId,
          status: 'running',
          toolName: data.toolName,
        })

        if (!isText) {
          writeJsonResponse({
            command,
            data: {args: data.args, event: 'toolCall', taskId, toolName: data.toolName},
            success: true,
          })
        }
      }),

      // Tool call completed (same as TUI updateToolCallResult)
      client.on<LlmToolResult>(LlmEvents.TOOL_RESULT, (data) => {
        if (!data.taskId) return

        let index = -1
        if (data.callId) {
          index = toolCalls.findIndex((tc) => tc.callId === data.callId)
        }

        if (index === -1) {
          for (let i = toolCalls.length - 1; i >= 0; i--) {
            if (toolCalls[i].toolName === data.toolName && toolCalls[i].status === 'running') {
              index = i
              break
            }
          }
        }

        if (index >= 0) {
          const tc = toolCalls[index]
          toolCalls[index] = {
            ...tc,
            error: data.error,
            result: data.result,
            status: data.success ? 'completed' : 'error',
            success: data.success,
          }

          if (isText) {
            const icon = data.success ? '✓' : '✗'
            log(`  ${icon} ${formatToolDisplay(tc.toolName, tc.args)}`)
          } else {
            writeJsonResponse({
              command,
              data: {
                error: data.error,
                event: 'toolResult',
                success: data.success,
                taskId,
                toolName: data.toolName,
              },
              success: true,
            })
          }
        }
      }),

      // Thinking started (same as TUI addReasoningContent)
      client.on<{taskId: string}>(LlmEvents.THINKING, (data) => {
        if (!data.taskId) return

        if (isText) {
          log('  Thinking...')
        } else {
          writeJsonResponse({
            command,
            data: {event: 'thinking', taskId},
            success: true,
          })
        }
      }),

      // Streaming chunk (same as TUI appendStreamingContent) — silent for CLI
      client.on<LlmChunk>(LlmEvents.CHUNK, () => {
        // Collected by TUI for streaming display; CLI doesn't render partial chunks
      }),

      // LLM response (final answer — used by query command)
      client.on<LlmResponse>(LlmEvents.RESPONSE, (data) => {
        if (!data.taskId || !onResponse) return
        onResponse(data.content, data.taskId)
      }),

      // Pending review notification — emitted by server after curate completes with review-required ops
      client.on<ReviewNotifyEvent>(ReviewEvents.NOTIFY, (data) => {
        if (data.taskId === taskId) {
          pendingReview = {pendingCount: data.pendingCount, reviewUrl: data.reviewUrl}
        }
      }),

      // Task completed
      client.on<TaskCompletedWithLogId>(TaskEvents.COMPLETED, (payload) => {
        if (payload.taskId !== taskId || completed) return
        completed = true
        cleanup()
        // Prefer pendingReviewCount embedded in payload (set synchronously by server before task:completed).
        // Falls back to review:notify capture for backward compatibility.
        const resolvedPendingReview =
          payload.pendingReviewCount !== undefined && payload.pendingReviewCount > 0
            ? {pendingCount: payload.pendingReviewCount, reviewUrl: pendingReview?.reviewUrl ?? ''}
            : pendingReview
        onCompleted({
          durationMs: payload.durationMs,
          logId: payload.logId,
          matchedDocs: payload.matchedDocs,
          pendingReview: resolvedPendingReview,
          result: payload.result,
          taskId,
          tier: payload.tier,
          toolCalls,
          topScore: payload.topScore,
        })
        resolve()
      }),

      // Task error
      client.on<TaskErrorWithLogId>(TaskEvents.ERROR, (payload) => {
        if (payload.taskId !== taskId || completed) return
        completed = true
        cleanup()
        onError({error: payload.error, logId: payload.logId, taskId, toolCalls})
        if (isText) {
          reject(Object.assign(new Error(payload.error.message), {code: payload.error.code ?? TaskErrorCode.TASK_EXECUTION}))
        } else {
          resolve()
        }
      }),

      // Connection state monitoring
      client.onStateChange((state) => {
        if (completed) return

        if (state === 'reconnecting') {
          disconnectTimer = setTimeout(() => {
            rejectRetryable('Daemon disconnected')
          }, DISCONNECT_GRACE_MS)
        }

        if (state === 'connected' && disconnectTimer) {
          clearTimeout(disconnectTimer)
          disconnectTimer = undefined
        }

        if (state === 'disconnected') {
          if (disconnectTimer) {
            clearTimeout(disconnectTimer)
            disconnectTimer = undefined
          }

          rejectRetryable('Daemon disconnected')
        }
      }),

      () => clearTimeout(timeout),
      () => {
        if (disconnectTimer) clearTimeout(disconnectTimer)
      },
    ]

    const cleanup = (): void => {
      for (const unsub of unsubscribers) unsub()
    }
  })
}
