/**
 * Activity Logs Hook
 *
 * Transforms sessionExecutions into ActivityLog format for display.
 */

import {join} from 'node:path'
import {useMemo} from 'react'
import {array as zArray, object as zObject, string as zString} from 'zod'

import type {ToolCall} from '../../core/domain/cipher/queue/types.js'
import type {ActivityLog} from '../types.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../constants.js'
import {useConsumer} from '../contexts/index.js'

const ExecutionInputSchema = zObject({
  content: zString(),
})

const CurateResultSchema = zObject({
  result: zObject({
    applied: zArray(
      zObject({
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
 * Extract file changes from curate tool calls
 */
export function composeChangesFromToolCalls(toolCalls: ToolCall[]): {created: string[]; updated: string[]} {
  const changes: {created: string[]; updated: string[]} = {created: [], updated: []}
  const contextTreeDir = join(BRV_DIR, CONTEXT_TREE_DIR)

  for (const tc of toolCalls) {
    if (tc.status !== 'completed' || tc.name !== 'curate' || !tc.result) {
      continue
    }

    const parseResult = CurateResultSchema.safeParse(JSON.parse(tc.result))
    if (!parseResult.success) {
      continue
    }

    const result = parseResult.data.result || {}

    for (const operation of result.applied || []) {
      if (operation.status !== 'success') {
        continue
      }

      const contextPath = join(contextTreeDir, operation.path, 'context.md')

      if (operation.type === 'ADD') {
        changes.created.push(contextPath)
      } else if (operation.type === 'UPDATE') {
        changes.updated.push(contextPath)
      }
    }
  }

  return changes
}

export interface UseActivityLogsReturn {
  /** Activity logs derived from session executions */
  logs: ActivityLog[]
}

/**
 * Hook that transforms sessionExecutions into ActivityLog format
 */
export function useActivityLogs(): UseActivityLogsReturn {
  const {sessionExecutions} = useConsumer()

  const logs = useMemo(
    () =>
      sessionExecutions.map(({execution, toolCalls}) => {
        const progress = toolCalls.map((tc) => ({
          id: tc.id,
          status: tc.status,
          toolCallName: tc.name,
        }))

        const changes = composeChangesFromToolCalls(toolCalls)

        const activityLog: ActivityLog = {
          changes,
          content: execution.status === 'failed' ? execution.error ?? '' : execution.result ?? '',
          id: execution.id,
          input: parseExecutionContent(execution.input),
          progress,
          source: 'agent',
          status: execution.status,
          timestamp: new Date(execution.updatedAt),
          type: execution.type,
        }

        return activityLog
      }),
    [sessionExecutions],
  )

  return {logs}
}
