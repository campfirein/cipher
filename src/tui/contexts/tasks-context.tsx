import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react'

import type {
  LlmResponseEvent,
  LlmToolCallEvent,
  LlmToolResultEvent,
  TaskCompletedEvent,
  TaskCreated,
  TaskErrorData,
  TaskStartedEvent,
  ToolErrorType,
} from '../../server/core/domain/transport/schemas.js'

import {TaskStats} from '../types/ui.js'
import {useTransport} from './transport-context.js'

/**
 * Task status derived from task lifecycle events.
 */
export type TaskStatus = 'cancelled' | 'completed' | 'created' | 'error' | 'started'

/**
 * Tool call tracking with status from toolResult.
 */
export type ToolCallEvent = {
  args: Record<string, unknown>
  callId?: string
  error?: string
  errorType?: ToolErrorType
  result?: unknown
  sessionId: string
  status: 'completed' | 'error' | 'running'
  toolName: string
}

/**
 * Task data aggregated from transport events.
 */
export type Task = {
  /** Task completion timestamp */
  completedAt?: number
  /** Task content/prompt */
  content: string
  /** Task creation timestamp */
  createdAt: number
  /** Error data if task failed */
  error?: TaskErrorData
  /** File paths for curate --files */
  files?: string[]
  /** Input of query/curate */
  input: string
  /** Result string if task completed */
  result?: string
  /** Session ID from LLM events */
  sessionId?: string
  /** Task start timestamp */
  startedAt?: number
  /** Current task status */
  status: TaskStatus
  /** Unique task identifier */
  taskId: string
  /** Tool calls executed during task */
  toolCalls: ToolCallEvent[]
  /** Task type */
  type: 'curate' | 'query'
}

/**
 * Context value for tasks state.
 */
export type TasksContextValue = {
  /** Clear all tasks from memory */
  clearTasks: () => void
  /** Get a specific task by ID */
  getTask: (taskId: string) => Task | undefined
  /** Transport statistics */
  stats: TaskStats
  /** Map of all tasks by taskId */
  tasks: Map<string, Task>
}

const TasksContext = createContext<TasksContextValue | undefined>(undefined)

/**
 * Provider component that subscribes to task events and maintains task state.
 * Tracks task lifecycle and LLM tool calls for all tasks.
 *
 * Event Flow:
 * 1. task:created → Create task with 'created' status
 * 2. task:started → Update to 'started' status
 * 3. llmservice:toolCall → Add tool call with 'running' status
 * 4. llmservice:toolResult → Update tool call status to 'completed' or 'error'
 * 5. llmservice:response → Update task result content from LLM response
 * 6. task:completed | task:error | task:cancelled → Terminal state
 */
export function TasksProvider({children}: {children: React.ReactNode}): React.ReactElement {
  const {client} = useTransport()
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map())

  useEffect(() => {
    if (!client) return

    const unsubscribers: Array<() => void> = []

    // Handle task:created - Initialize new task
    const handleTaskCreated = (data: TaskCreated) => {
      setTasks((prev) => {
        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          completedAt: undefined,
          content: data.content,
          createdAt: Date.now(),
          error: undefined,
          files: data.files,
          input: data.content,
          result: undefined,
          sessionId: undefined,
          startedAt: undefined,
          status: 'created',
          taskId: data.taskId,
          toolCalls: [],
          type: data.type,
        })
        return newTasks
      })
    }

    // Handle task:started - Update status and timestamp
    const handleTaskStarted = (data: TaskStartedEvent) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          startedAt: Date.now(),
          status: 'started',
        })
        return newTasks
      })
    }

    // Handle task:completed - Set result and completion time
    const handleTaskCompleted = (data: TaskCompletedEvent) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          completedAt: Date.now(),
          status: 'completed',
        })
        return newTasks
      })
    }

    // Handle task:error - Set error and completion time
    const handleTaskError = (data: {error: TaskErrorData; taskId: string}) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          completedAt: Date.now(),
          error: data.error,
          status: 'error',
        })
        return newTasks
      })
    }

    // Handle task:cancelled - Set cancelled status
    const handleTaskCancelled = (data: {taskId: string}) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          completedAt: Date.now(),
          status: 'cancelled',
        })
        return newTasks
      })
    }

    // Handle llmservice:toolCall - Add new tool call with 'running' status
    const handleToolCall = (data: LlmToolCallEvent) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          sessionId: data.sessionId,
          toolCalls: [
            ...task.toolCalls,
            {
              args: data.args,
              callId: data.callId,
              sessionId: data.sessionId,
              status: 'running',
              toolName: data.toolName,
            },
          ],
        })
        return newTasks
      })
    }

    // Handle llmservice:toolResult - Update tool call status
    const handleToolResult = (data: LlmToolResultEvent) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        // Find the tool call to update (match by callId if present, otherwise by toolName and most recent)
        const toolCallIndex = task.toolCalls.findIndex((tc) => tc.callId === data.callId)

        if (toolCallIndex === -1) return prev

        const updatedToolCalls = [...task.toolCalls]
        updatedToolCalls[toolCallIndex] = {
          ...updatedToolCalls[toolCallIndex],
          error: data.error,
          errorType: data.errorType,
          result: data.result,
          status: data.success ? 'completed' : 'error',
        }

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          toolCalls: updatedToolCalls,
        })
        return newTasks
      })
    }

    // Handle llmservice:response - Update task content from LLM response
    const handleResponse = (data: LlmResponseEvent) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          result: data.content,
          sessionId: data.sessionId,
        })
        return newTasks
      })
    }

    // Subscribe to events
    unsubscribers.push(
      client.on<TaskCreated>('task:created', handleTaskCreated),
      client.on<TaskStartedEvent>('task:started', handleTaskStarted),
      client.on<TaskCompletedEvent>('task:completed', handleTaskCompleted),
      client.on<{error: TaskErrorData; taskId: string}>('task:error', handleTaskError),
      client.on<{taskId: string}>('task:cancelled', handleTaskCancelled),
      client.on<LlmToolCallEvent>('llmservice:toolCall', handleToolCall),
      client.on<LlmToolResultEvent>('llmservice:toolResult', handleToolResult),
      client.on<LlmResponseEvent>('llmservice:response', handleResponse),
    )

    // Cleanup subscriptions
    return () => {
      for (const unsub of unsubscribers) unsub()
    }
  }, [client])

  // Clear all tasks from memory
  const clearTasks = useCallback(() => {
    setTasks(new Map())
  }, [])

  // Helper function to get task by ID
  const getTask = useCallback((taskId: string) => tasks.get(taskId), [tasks])

  // Calculate transport stats
  const stats = useMemo<TaskStats>(() => {
    let created = 0
    let started = 0

    for (const task of tasks.values()) {
      if (task.status === 'created') {
        created++
      } else if (task.status === 'started') {
        started++
      }
    }

    return {created, started}
  }, [tasks])

  const value: TasksContextValue = {
    clearTasks,
    getTask,
    stats,
    tasks,
  }

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

/**
 * Hook to access tasks context.
 * Must be used within a TasksProvider.
 */
export function useTasks(): TasksContextValue {
  const context = useContext(TasksContext)
  if (!context) {
    throw new Error('useTasks must be used within a TasksProvider')
  }

  return context
}
