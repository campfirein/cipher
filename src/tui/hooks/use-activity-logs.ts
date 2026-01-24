/**
 * Activity Logs Hook
 *
 * Transforms tasks from transport events into ActivityLog format for display.
 */

import {useMemo} from 'react'
import {array as zArray, object as zObject, string as zString} from 'zod'

import type {ExecutionStatus, ToolCallStatus} from '../../core/domain/cipher/queue/types.js'
import type {Task, ToolCallEvent} from '../contexts/tasks-context.js'
import type {ActivityLog} from '../types.js'

import {useTasks} from '../contexts/tasks-context.js'

const ExecutionInputSchema = zObject({
  content: zString(),
})

const CurateResultSchema = zObject({
  result: zObject({
    applied: zArray(
      zObject({
        filePath: zString(),
        path: zString(),
        status: zString(),
        type: zString(),
      }),
    ).optional(),
  }).optional(),
})

/**
 * Parse execution input to extract content
 */
export function parseExecutionContent(input: string): string {
  try {
    return ExecutionInputSchema.safeParse(JSON.parse(input))?.data?.content ?? input
  } catch {
    return input
  }
}

/**
 * Extract file changes from curate tool calls (transport events)
 */
function composeChangesFromToolCalls(toolCalls: ToolCallEvent[]): {created: string[]; updated: string[]} {
  const changes: {created: string[]; updated: string[]} = {created: [], updated: []}

  for (const tc of toolCalls) {
    if (tc.status !== 'completed' || tc.toolName !== 'curate' || !tc.result) {
      continue
    }

    // Parse JSON - skip if invalid
    let parsed: unknown
    try {
      parsed = JSON.parse(String(tc.result))
    } catch {
      continue
    }

    // Validate schema with safeParse
    const parseResult = CurateResultSchema.safeParse(parsed)
    if (!parseResult.success) {
      continue
    }

    const result = parseResult.data.result || {}

    for (const operation of result.applied || []) {
      if (operation.status !== 'success') {
        continue
      }

      if (operation.type === 'ADD') {
        changes.created.push(operation.filePath)
      } else if (operation.type === 'UPDATE') {
        changes.updated.push(operation.filePath)
      }
    }
  }

  return changes
}

export interface UseActivityLogsReturn {
  /** Activity logs derived from tasks */
  logs: ActivityLog[]
}

/**
 * Map task status to execution status
 */
function mapTaskStatusToExecutionStatus(taskStatus: Task['status']): ExecutionStatus {
  switch (taskStatus) {
    case 'cancelled': {
      return 'failed'
    }

    case 'completed': {
      return 'completed'
    }

    case 'created':
    case 'started': {
      return 'running'
    }

    case 'error': {
      return 'failed'
    }

    default: {
      return 'running'
    }
  }
}

/**
 * Map tool call status to ToolCallStatus
 */
function mapToolCallStatus(status: ToolCallEvent['status']): ToolCallStatus {
  switch (status) {
    case 'completed': {
      return 'completed'
    }

    case 'error': {
      return 'failed'
    }

    case 'running': {
      return 'running'
    }

    default: {
      return 'running'
    }
  }
}

/**
 * Hook that transforms tasks from transport events into ActivityLog format
 */
export function useActivityLogs(): UseActivityLogsReturn {
  const {tasks} = useTasks()

  const logs = useMemo(() => {
    const taskArray = [...tasks.values()]

    return taskArray
      .filter((task) => task.status !== 'created')
      .map((task) => {
        // Include tool args in progress items for display
        const progress = task.toolCalls.map((tc, index) => ({
          args: tc.args,
          id: tc.callId ?? `${task.taskId}-${index}`,
          status: mapToolCallStatus(tc.status),
          toolCallName: tc.toolName,
        }))

        const changes = composeChangesFromToolCalls(task.toolCalls)

        const activityLog: ActivityLog = {
          changes,
          content: task.status === 'error' ? task.error?.message ?? '' : task.result ?? '',
          id: task.taskId,
          input: task.content,
          isReasoningStreaming: task.isReasoningStreaming,
          isStreaming: task.isStreaming,
          isTextStreaming: task.isTextStreaming,
          progress,
          reasoningContent: task.reasoningContent,
          source: 'agent',
          status: mapTaskStatusToExecutionStatus(task.status),
          streamingContent: task.streamingContent,
          timestamp: new Date(task.completedAt ?? task.startedAt ?? task.createdAt),
          type: task.type,
        }

        return activityLog
      })
  }, [tasks])

  return {logs}
}
