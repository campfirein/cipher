import type {
  LlmChunk,
  LlmResponse,
  LlmToolCall,
  LlmToolResult,
  TaskCompleted,
  TaskCreated,
  TaskErrorData,
  TaskStarted,
  ToolErrorType,
} from '@campfirein/brv-transport-client'

import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react'

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
  timestamp: number
  toolName: string
}

/**
 * Reasoning content item with timestamp for sorting.
 */
export type ReasoningContentItem = {
  content: string
  isThinking?: boolean
  timestamp: number
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
  /** Folder paths for curate-folder */
  folders?: string[]
  /** Input of query/curate */
  input: string
  /** Whether task is currently streaming LLM response */
  isStreaming?: boolean
  /** Accumulated reasoning/thinking content items with timestamps */
  reasoningContents?: ReasoningContentItem[]
  /** Result string if task completed */
  result?: string
  /** Session ID from LLM events */
  sessionId?: string
  /** Task start timestamp */
  startedAt?: number
  /** Current task status */
  status: TaskStatus
  /** Accumulated streaming text content during LLM response */
  streamingContent?: string
  /** Unique task identifier */
  taskId: string
  /** Tool calls executed during task */
  toolCalls: ToolCallEvent[]
  /** Task type */
  type: 'curate' | 'curate-folder' | 'query'
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
    // Extended type to include folderPath (not yet in transport-client package)
    const handleTaskCreated = (data: TaskCreated & {folderPath?: string}) => {
      // Convert folderPath to folders array for consistent handling
      const folders = data.folderPath ? [data.folderPath] : undefined
      setTasks((prev) => {
        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          completedAt: undefined,
          content: data.content,
          createdAt: Date.now(),
          error: undefined,
          files: data.files,
          folders,
          input: data.content,
          result: undefined,
          sessionId: undefined,
          startedAt: undefined,
          status: 'created',
          taskId: data.taskId,
          toolCalls: [],
          type: data.type as 'curate' | 'curate-folder' | 'query',
        })
        return newTasks
      })
    }

    // Handle task:started - Update status and timestamp
    const handleTaskStarted = (data: TaskStarted) => {
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
    // If task doesn't exist (e.g., missed task:created event from MCP), create a minimal entry
    // Also marks any remaining 'running' tool calls as 'completed' since task is done
    const handleTaskCompleted = (data: TaskCompleted) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        const now = Date.now()
        const newTasks = new Map(prev)

        if (task) {
          // Mark any remaining 'running' tool calls as 'completed'
          // This handles cases where toolResult events were missed or arrived out of order
          const finalizedToolCalls = task.toolCalls.map((tc) =>
            tc.status === 'running' ? {...tc, status: 'completed' as const} : tc,
          )

          // Filter out incomplete reasoning content (still thinking)
          const finalizedReasoningContent = task.reasoningContents?.filter((rc) => !rc.isThinking)

          // Normal case: update existing task
          newTasks.set(data.taskId, {
            ...task,
            completedAt: now,
            reasoningContents: finalizedReasoningContent,
            result: data.result,
            status: 'completed',
            toolCalls: finalizedToolCalls,
          })
        } else {
          // Task not found - create minimal entry (handles missed task:created events)
          newTasks.set(data.taskId, {
            completedAt: now,
            content: '',
            createdAt: now,
            error: undefined,
            files: undefined,
            input: '',
            result: data.result,
            sessionId: undefined,
            startedAt: now,
            status: 'completed',
            taskId: data.taskId,
            toolCalls: [],
            type: 'query', // Default to query; will be overridden if task:created arrives later
          })
        }

        return newTasks
      })
    }

    // Handle task:error - Set error and completion time
    // If task doesn't exist, create minimal entry (handles missed task:created events)
    // Also marks any remaining 'running' tool calls as 'error' since task failed
    const handleTaskError = (data: {error: TaskErrorData; taskId: string}) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        const now = Date.now()
        const newTasks = new Map(prev)

        if (task) {
          // Mark any remaining 'running' tool calls as 'error'
          const finalizedToolCalls = task.toolCalls.map((tc) =>
            tc.status === 'running' ? {...tc, status: 'error' as const} : tc,
          )

          newTasks.set(data.taskId, {
            ...task,
            completedAt: now,
            error: data.error,
            status: 'error',
            toolCalls: finalizedToolCalls,
          })
        } else {
          // Task not found - create minimal entry
          newTasks.set(data.taskId, {
            completedAt: now,
            content: '',
            createdAt: now,
            error: data.error,
            files: undefined,
            input: '',
            result: undefined,
            sessionId: undefined,
            startedAt: now,
            status: 'error',
            taskId: data.taskId,
            toolCalls: [],
            type: 'query',
          })
        }

        return newTasks
      })
    }

    // Handle task:cancelled - Set cancelled status
    // If task doesn't exist, create minimal entry (handles missed task:created events)
    const handleTaskCancelled = (data: {taskId: string}) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        const now = Date.now()
        const newTasks = new Map(prev)

        if (task) {
          newTasks.set(data.taskId, {
            ...task,
            completedAt: now,
            status: 'cancelled',
          })
        } else {
          // Task not found - create minimal entry
          newTasks.set(data.taskId, {
            completedAt: now,
            content: '',
            createdAt: now,
            error: undefined,
            files: undefined,
            input: '',
            result: undefined,
            sessionId: undefined,
            startedAt: now,
            status: 'cancelled',
            taskId: data.taskId,
            toolCalls: [],
            type: 'query',
          })
        }

        return newTasks
      })
    }

    // Handle llmservice:toolCall - Add new tool call or update existing one
    // Tool calls may be emitted multiple times (once from stream with empty args, once from execution with actual args)
    // We use callId to deduplicate and merge the data
    // Handle llmservice:toolCall - Add new tool call with 'running' status
    const handleToolCall = (data: LlmToolCall) => {
      // Guard: taskId is optional in package types but required for transport events
      const {taskId} = data
      if (!taskId) return

      setTasks((prev) => {
        const task = prev.get(taskId)
        if (!task) return prev

        const newTasks = new Map(prev)

        // Check if we already have a tool call with this callId
        const existingIndex = data.callId ? task.toolCalls.findIndex((tc) => tc.callId === data.callId) : -1

        if (existingIndex >= 0) {
          // Update existing tool call with new data (merge args if new ones have content)
          const existingToolCall = task.toolCalls[existingIndex]
          const hasNewArgs = data.args && Object.keys(data.args).length > 0
          const updatedToolCalls = [...task.toolCalls]
          updatedToolCalls[existingIndex] = {
            ...existingToolCall,
            args: hasNewArgs ? data.args : existingToolCall.args,
            sessionId: data.sessionId,
          }
          newTasks.set(taskId, {
            ...task,
            sessionId: data.sessionId,
            toolCalls: updatedToolCalls,
          })
        } else {
          // Add new tool call
          newTasks.set(taskId, {
            ...task,
            sessionId: data.sessionId,
            toolCalls: [
              ...task.toolCalls,
              {
                args: data.args,
                callId: data.callId,
                sessionId: data.sessionId,
                status: 'running',
                timestamp: Date.now(),
                toolName: data.toolName,
              },
            ],
          })
        }

        return newTasks
      })
    }

    // Handle llmservice:toolResult - Update tool call status
    const handleToolResult = (data: LlmToolResult) => {
      // Guard: taskId is optional in package types but required for transport events
      const {taskId} = data
      if (!taskId) return

      setTasks((prev) => {
        const task = prev.get(taskId)
        if (!task) return prev

        // Find the tool call to update using multiple strategies:
        // 1. Match by callId (most reliable when both have callId)
        // 2. Fallback: match by toolName for most recent 'running' tool call
        let toolCallIndex = -1

        // Strategy 1: Match by callId if present in both
        if (data.callId) {
          toolCallIndex = task.toolCalls.findIndex((tc) => tc.callId === data.callId)
        }

        // Strategy 2: Fallback to toolName matching for most recent running tool
        if (toolCallIndex === -1 && data.toolName) {
          for (let i = task.toolCalls.length - 1; i >= 0; i--) {
            if (task.toolCalls[i].toolName === data.toolName && task.toolCalls[i].status === 'running') {
              toolCallIndex = i
              break
            }
          }
        }

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
        newTasks.set(taskId, {
          ...task,
          toolCalls: updatedToolCalls,
        })
        return newTasks
      })
    }

    // Handle llmservice:thinking - Add a new reasoning content item with isThinking: true
    // Deduplicates consecutive thinking events to prevent multiple "Thinking." entries
    // from appearing when the agentic loop emits thinking per iteration or subagent events leak
    const handleThinking = (data: {taskId: string}) => {
      setTasks((prev) => {
        const task = prev.get(data.taskId)
        if (!task) return prev

        // Don't add another thinking item if the last one is still in thinking state
        const existingContent = task.reasoningContents ?? []
        const lastItem = existingContent.at(-1)
        if (lastItem?.isThinking) {
          return prev
        }

        const newReasoningItem: ReasoningContentItem = {
          content: '',
          isThinking: true,
          timestamp: Date.now(),
        }

        const newTasks = new Map(prev)
        newTasks.set(data.taskId, {
          ...task,
          reasoningContents: [...existingContent, newReasoningItem],
        })
        return newTasks
      })
    }

    // Handle llmservice:chunk - Accumulate streaming content for real-time display
    // Separates reasoning/thinking content from regular text content
    // For reasoning chunks, updates the last item with isThinking: true (paired with thinking event)
    const handleChunk = (data: LlmChunk) => {
      const {taskId} = data
      if (!taskId) return
      setTasks((prev) => {
        const task = prev.get(taskId)
        if (!task) return prev

        const newTasks = new Map(prev)

        // Route content to appropriate field based on type
        if (data.type === 'reasoning') {
          const existingContent = task.reasoningContents ?? []
          const lastIndex = existingContent.length - 1
          const lastItem = existingContent[lastIndex]

          // Update the last reasoning item (paired with thinking event)
          if (lastItem) {
            const updatedContent = [...existingContent]
            updatedContent[lastIndex] = {
              ...lastItem,
              content: lastItem.content + data.content,
              isThinking: false,
            }
            newTasks.set(taskId, {
              ...task,
              isStreaming: !data.isComplete,
              reasoningContents: updatedContent,
              sessionId: data.sessionId,
            })
          }
        } else {
          newTasks.set(taskId, {
            ...task,
            isStreaming: !data.isComplete,
            sessionId: data.sessionId,
            streamingContent: (task.streamingContent ?? '') + data.content,
          })
        }

        return newTasks
      })
    }

    // Handle llmservice:response - Update task content from LLM response
    // Also clears streaming state since response marks end of streaming
    const handleResponse = (data: LlmResponse) => {
      // Guard: taskId is optional in package types but required for transport events
      const {taskId} = data
      if (!taskId) return

      setTasks((prev) => {
        const task = prev.get(taskId)
        if (!task) return prev

        const newTasks = new Map(prev)
        newTasks.set(taskId, {
          ...task,
          isStreaming: false,
          result: data.content,
          sessionId: data.sessionId,
          streamingContent: undefined, // Clear streaming content once final response received
        })
        return newTasks
      })
    }

    // Subscribe to events
    unsubscribers.push(
      client.on<TaskCreated>('task:created', handleTaskCreated),
      client.on<TaskStarted>('task:started', handleTaskStarted),
      client.on<TaskCompleted>('task:completed', handleTaskCompleted),
      client.on<{error: TaskErrorData; taskId: string}>('task:error', handleTaskError),
      client.on<{taskId: string}>('task:cancelled', handleTaskCancelled),
      client.on<LlmToolCall>('llmservice:toolCall', handleToolCall),
      client.on<LlmToolResult>('llmservice:toolResult', handleToolResult),
      client.on<LlmResponse>('llmservice:response', handleResponse),
      client.on<{taskId: string}>('llmservice:thinking', handleThinking),
      client.on<LlmChunk>('llmservice:chunk', handleChunk),
      client.on<LlmToolCall>('llmservice:toolCall', handleToolCall),
      client.on<LlmToolResult>('llmservice:toolResult', handleToolResult),
      client.on<LlmResponse>('llmservice:response', handleResponse),
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

