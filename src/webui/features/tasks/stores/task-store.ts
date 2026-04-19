/**
 * Tasks store
 *
 * Holds the snapshot of curate/query tasks streamed from the daemon for the
 * currently-selected project. Live `task:*` events feed it via
 * useTaskSubscriptions; the initial snapshot comes from the `task:list` query.
 *
 * Persisted to sessionStorage so a page refresh keeps recently-finished tasks
 * visible — the daemon only retains completed tasks for ~5s (TaskRouter grace
 * period), so without this cache, refreshing wipes the task history.
 */

import {create} from 'zustand'
import {createJSONStorage, persist} from 'zustand/middleware'

import type {TaskListItem, TaskListItemStatus} from '../../../../shared/transport/events/task-events'
import type {ReasoningContentItem, StoredTask, ToolCallEvent} from '../types/stored-task'

import {mergeTaskList, removeTaskFromList} from '../utils/merge-tasks'
import {
  addReasoningContentTo,
  addToolCallTo,
  appendStreamingContentTo,
  setResponseOn,
  updateToolCallResultIn,
} from '../utils/task-events'
import {isTerminalStatus} from '../utils/task-status'

export type StatusFilter = 'all' | 'cancelled' | 'completed' | 'failed' | 'running'
export type TypeFilter = 'all' | 'curate' | 'query'

interface TaskState {
  searchQuery: string
  statusFilter: StatusFilter
  tasks: StoredTask[]
  typeFilter: TypeFilter
}

interface UpdateToolCallResultArgs {
  callId: string | undefined
  error?: string
  errorType?: string
  result?: unknown
  success: boolean
  taskId: string
  toolName: string
}

interface TaskActions {
  addReasoningContent: (taskId: string, item: ReasoningContentItem) => void
  addToolCall: (taskId: string, toolCall: ToolCallEvent) => void
  appendStreamingContent: (params: {
    content: string
    isComplete: boolean
    sessionId?: string
    taskId: string
    type: 'reasoning' | 'text'
  }) => void
  clearCompleted: () => void
  mergeTasks: (incoming: TaskListItem[]) => void
  removeTask: (taskId: string) => void
  reset: () => void
  setResponse: (taskId: string, content: string, sessionId?: string) => void
  setSearchQuery: (query: string) => void
  setStatusFilter: (filter: StatusFilter) => void
  setTypeFilter: (filter: TypeFilter) => void
  updateToolCallResult: (args: UpdateToolCallResultArgs) => void
  upsertStatus: (taskId: string, patch: Partial<TaskListItem> & {status: TaskListItemStatus}) => void
}

const initial: TaskState = {
  searchQuery: '',
  statusFilter: 'all',
  tasks: [],
  typeFilter: 'all',
}

function applyToTask(
  state: TaskState,
  taskId: string,
  mutate: (task: StoredTask) => StoredTask,
): Partial<TaskState> | undefined {
  const idx = state.tasks.findIndex((task) => task.taskId === taskId)
  if (idx === -1) return undefined
  const next = mutate(state.tasks[idx])
  if (next === state.tasks[idx]) return undefined
  const tasks = [...state.tasks]
  tasks[idx] = next
  return {tasks}
}

export const useTaskStore = create<TaskActions & TaskState>()(
  persist(
    (set, get) => ({
      ...initial,

      addReasoningContent: (taskId, item) =>
        set((state) => applyToTask(state, taskId, (task) => addReasoningContentTo(task, item)) ?? {}),

      addToolCall: (taskId, toolCall) =>
        set((state) => applyToTask(state, taskId, (task) => addToolCallTo(task, toolCall)) ?? {}),

      appendStreamingContent: ({content, isComplete, sessionId, taskId, type}) =>
        set(
          (state) =>
            applyToTask(state, taskId, (task) =>
              appendStreamingContentTo(task, {content, isComplete, sessionId, type}),
            ) ?? {},
        ),

      clearCompleted: () => set((state) => ({tasks: state.tasks.filter((task) => !isTerminalStatus(task.status))})),

      mergeTasks: (incoming) => set((state) => ({tasks: mergeTaskList(state.tasks, incoming)})),

      removeTask: (taskId) => set((state) => ({tasks: removeTaskFromList(state.tasks, taskId)})),

      reset: () => set({...initial}),

      setResponse: (taskId, content, sessionId) =>
        set((state) => applyToTask(state, taskId, (task) => setResponseOn(task, {content, sessionId})) ?? {}),

      setSearchQuery: (query) => set({searchQuery: query}),

      setStatusFilter: (filter) => set({statusFilter: filter}),

      setTypeFilter: (filter) => set({typeFilter: filter}),

      updateToolCallResult: ({callId, error, errorType, result, success, taskId, toolName}) =>
        set(
          (state) =>
            applyToTask(state, taskId, (task) =>
              updateToolCallResultIn(task, {callId, error, errorType, result, success, toolName}),
            ) ?? {},
        ),

      upsertStatus(taskId, patch) {
        const existing = get().tasks.find((task) => task.taskId === taskId)
        const next: TaskListItem = existing
          ? {...existing, ...patch}
          : {
              content: '',
              createdAt: Date.now(),
              type: 'unknown',
              ...patch,
              taskId,
            }
        set((state) => ({tasks: mergeTaskList(state.tasks, [next])}))
      },
    }),
    {
      name: 'brv-tasks',
      partialize: (state) => ({tasks: state.tasks}),
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)

export const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'completed', 'failed', 'cancelled']

export function statusMatchesFilter(status: TaskListItemStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'running') return status === 'started' || status === 'created'
  if (filter === 'completed') return status === 'completed'
  if (filter === 'failed') return status === 'error'
  if (filter === 'cancelled') return status === 'cancelled'
  return true
}

export function taskMatchesQuery(task: StoredTask, query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return (
    task.content.toLowerCase().includes(needle) ||
    task.taskId.toLowerCase().includes(needle) ||
    task.type.toLowerCase().includes(needle)
  )
}

export const useTaskById = (taskId: string | undefined): StoredTask | undefined => useTaskStore((s) => (taskId ? s.tasks.find((task) => task.taskId === taskId) : undefined))

export interface StatusBreakdown {
  all: number
  cancelled: number
  completed: number
  failed: number
  running: number
}

export const useStatusBreakdown = (): StatusBreakdown => {
  const tasks = useTaskStore((s) => s.tasks)
  const breakdown: StatusBreakdown = {all: tasks.length, cancelled: 0, completed: 0, failed: 0, running: 0}
  for (const task of tasks) {
    switch (task.status) {
      case 'cancelled': {
        breakdown.cancelled++
        break
      }

      case 'completed': {
        breakdown.completed++
        break
      }

      case 'created':
      case 'started': {
        breakdown.running++
        break
      }

      case 'error': {
        breakdown.failed++
        break
      }

      default:
    }
  }

  return breakdown
}

export const useTaskCounts = () => {
  const tasks = useTaskStore((s) => s.tasks)
  let pending = 0
  let inProgress = 0
  let completed = 0
  for (const task of tasks) {
    if (task.status === 'created') pending++
    else if (task.status === 'started') inProgress++
    else completed++
  }

  return {completed, inProgress, pending, total: tasks.length}
}
