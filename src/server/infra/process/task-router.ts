/**
 * TaskRouter - Routes task and LLM events between clients and agents.
 *
 * Handles:
 * - Task lifecycle: create → ack → started → completed/error/cancelled
 * - LLM event routing: llmservice:* events from agent → client + project room
 * - Grace period: keeps completed tasks briefly for late-arriving LLM events
 * - Lifecycle hooks: extensible observer hooks (e.g. CurateLogHandler)
 *
 * Broadcasting: Task/LLM events are broadcast to project-scoped rooms
 * (project:<sanitizedPath>:broadcast) so only clients in the same project
 * receive them. Global events (auth, agent connect/disconnect) remain on
 * the global broadcast channel.
 *
 * Consumed by TransportHandlers (orchestrator).
 */

import type {ReasoningContentItem, ToolCallEvent} from '../../../shared/transport/events/task-events.js'
import type {TaskHistoryEntry} from '../../core/domain/entities/task-history-entry.js'
import type {
  LlmChunkEvent,
  LlmErrorEvent,
  LlmResponseEvent,
  LlmThinkingEvent,
  LlmToolCallEvent,
  LlmToolResultEvent,
  LlmUnsupportedInputEvent,
  TaskCancelledEvent,
  TaskCancelRequest,
  TaskCancelResponse,
  TaskClearCompletedRequest,
  TaskClearCompletedResponse,
  TaskCompletedEvent,
  TaskCreateRequest,
  TaskCreateResponse,
  TaskDeleteBulkRequest,
  TaskDeleteBulkResponse,
  TaskDeleteRequest,
  TaskDeleteResponse,
  TaskErrorEvent,
  TaskExecute,
  TaskGetRequest,
  TaskGetResponse,
  TaskListItem,
  TaskListItemStatus,
  TaskListRequest,
  TaskListResponse,
  TaskStartedEvent,
} from '../../core/domain/transport/schemas.js'
import type {IAgentPool} from '../../core/interfaces/agent/i-agent-pool.js'
import type {ITaskLifecycleHook} from '../../core/interfaces/process/i-task-lifecycle-hook.js'
import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../core/interfaces/routing/i-project-router.js'
import type {ITaskHistoryStore, TaskHistoryStatus} from '../../core/interfaces/storage/i-task-history-store.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {TaskInfo} from './types.js'

import {TASK_HISTORY_ID_PREFIX} from '../../constants.js'
import {TASK_HISTORY_SCHEMA_VERSION, TaskHistoryEntrySchema} from '../../core/domain/entities/task-history-entry.js'
import {AgentNotAvailableError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {LlmEventNames, TransportLlmEventList, TransportTaskEventNames} from '../../core/domain/transport/schemas.js'
import {isDescendantOf} from '../../utils/path-utils.js'
import {transportLog} from '../../utils/process-logger.js'
import {isValidTaskType} from '../../utils/type-guards.js'
import {resolveProject} from '../project/resolve-project.js'
import {broadcastToProjectRoom} from './broadcast-utils.js'

type LlmEventName = (typeof TransportLlmEventList)[number]

type LlmEventPayloadMap = {
  [LlmEventNames.CHUNK]: LlmChunkEvent
  [LlmEventNames.ERROR]: LlmErrorEvent
  [LlmEventNames.RESPONSE]: LlmResponseEvent
  [LlmEventNames.THINKING]: LlmThinkingEvent
  [LlmEventNames.TOOL_CALL]: LlmToolCallEvent
  [LlmEventNames.TOOL_RESULT]: LlmToolResultEvent
  [LlmEventNames.UNSUPPORTED_INPUT]: LlmUnsupportedInputEvent
}

/**
 * Grace period (in ms) to keep completed tasks in memory for late-arriving events.
 * Prevents silent event drops when llmservice:* events arrive after task:completed.
 */
const TASK_CLEANUP_GRACE_PERIOD_MS = 5000

/** Default page size for `task:list` when caller omits `limit`. Schema caps at 1000. */
const DEFAULT_TASK_LIST_LIMIT = 50

/** Statuses considered terminal for delete refusal (M2.09). */
const TERMINAL_STATUSES: ReadonlySet<TaskListItemStatus> = new Set(['cancelled', 'completed', 'error'])

/**
 * Outcome of the daemon-side pre-dispatch check.
 *
 * `skipResult` is the full string sent to the client as the task:completed `result`.
 * The callback owns the message format so task-router stays task-type-agnostic
 * (e.g. dream uses "Dream skipped: <reason>"; future task types can use their own).
 */
export type PreDispatchCheckResult = {eligible: false; skipResult: string} | {eligible: true}

export type PreDispatchCheck = (task: TaskCreateRequest, projectPath?: string) => Promise<PreDispatchCheckResult>

type TaskRouterOptions = {
  agentPool?: IAgentPool
  /** Function to resolve agent clientId for a given project */
  getAgentForProject: (projectPath?: string) => string | undefined
  /**
   * Per-project `ITaskHistoryStore` factory (DIP). When omitted, the new
   * persistent-history handlers (`task:list` paginated, `task:get`,
   * `task:delete*`, `task:clearCompleted`) gracefully degrade to in-memory
   * only — keeping pre-M2.09 unit tests unaffected.
   */
  getTaskHistoryStore?: (projectPath: string) => ITaskHistoryStore
  /** Lifecycle hooks for task events (e.g. CurateLogHandler). */
  lifecycleHooks?: ITaskLifecycleHook[]
  /**
   * Optional daemon-side gate run before dispatching to the agent pool. If it
   * resolves ineligible, task-router short-circuits with task:completed carrying
   * the skip reason and never submits the task to an agent.
   * Used for dream task type to enforce gates 1-3 (time, activity, queue) even
   * on the CLI dispatch path — mirrors the idle-trigger pre-check pattern.
   */
  preDispatchCheck?: PreDispatchCheck
  projectRegistry?: IProjectRegistry
  projectRouter?: IProjectRouter
  /**
   * Resolves the active provider/model snapshot at task-create time.
   * Failures are swallowed (fail-open) so dispatch is never blocked.
   */
  resolveActiveProvider?: () => Promise<{model?: string; provider?: string}>
  /** Resolves the projectPath a client registered with (from client:register). */
  resolveClientProjectPath?: (clientId: string) => string | undefined
  transport: ITransportServer
}

function hasTaskId(data: unknown): data is {[key: string]: unknown; taskId: string} {
  return typeof data === 'object' && data !== null && 'taskId' in data && typeof data.taskId === 'string'
}

function matchesListFilters(
  item: TaskListItem,
  filters: {before?: number; projectFilter: string; statusFilter?: TaskListItemStatus[]},
): boolean {
  const taskProject = item.projectPath
  if (taskProject !== undefined && taskProject !== filters.projectFilter) return false
  if (filters.before !== undefined && item.createdAt >= filters.before) return false
  if (filters.statusFilter && filters.statusFilter.length > 0 && !filters.statusFilter.includes(item.status)) {
    return false
  }

  return true
}

/**
 * Build a `TaskHistoryEntry` from in-memory `TaskInfo` for `handleTaskGet`.
 * Mirrors `TaskHistoryHook.baseFromTaskInfo` + `statusShapeFromTaskInfo`
 * (M2.06) — kept inline rather than imported because the hook → router
 * direction would deepen TaskRouter's coupling. If both drift, sync here +
 * in `task-history-hook.ts`. Future M2.x refactor: extract to
 * `task-history-entry-builder.ts`.
 */
function synthesizeEntryFromTaskInfo(task: TaskInfo): TaskHistoryEntry | undefined {
  if (task.projectPath === undefined) return undefined

  const base: Record<string, unknown> = {
    content: task.content,
    createdAt: task.createdAt,
    id: `${TASK_HISTORY_ID_PREFIX}-${task.taskId}`,
    projectPath: task.projectPath,
    schemaVersion: TASK_HISTORY_SCHEMA_VERSION,
    taskId: task.taskId,
    type: task.type,
    ...(task.clientCwd === undefined ? {} : {clientCwd: task.clientCwd}),
    ...(task.files === undefined ? {} : {files: task.files}),
    ...(task.folderPath === undefined ? {} : {folderPath: task.folderPath}),
    ...(task.logId === undefined ? {} : {logId: task.logId}),
    ...(task.model === undefined ? {} : {model: task.model}),
    ...(task.provider === undefined ? {} : {provider: task.provider}),
    ...(task.reasoningContents === undefined ? {} : {reasoningContents: task.reasoningContents}),
    ...(task.responseContent === undefined ? {} : {responseContent: task.responseContent}),
    ...(task.sessionId === undefined ? {} : {sessionId: task.sessionId}),
    ...(task.toolCalls === undefined ? {} : {toolCalls: task.toolCalls}),
    ...(task.worktreeRoot === undefined ? {} : {worktreeRoot: task.worktreeRoot}),
  }

  const candidate = {...base, ...statusShapeForSynthesis(task)}
  const parsed = TaskHistoryEntrySchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

function statusShapeForSynthesis(task: TaskInfo): Record<string, unknown> {
  switch (task.status) {
    case 'cancelled':
    case 'completed': {
      return {
        completedAt: task.completedAt ?? Date.now(),
        status: task.status,
        ...(task.startedAt === undefined ? {} : {startedAt: task.startedAt}),
        ...(task.status === 'completed' && task.result !== undefined ? {result: task.result} : {}),
      }
    }

    case 'error': {
      return {
        completedAt: task.completedAt ?? Date.now(),
        error: task.error ?? {code: 'TASK_ERROR', message: 'unknown error', name: 'TaskError'},
        status: 'error',
        ...(task.startedAt === undefined ? {} : {startedAt: task.startedAt}),
      }
    }

    case 'started': {
      return {startedAt: task.startedAt ?? task.createdAt, status: 'started'}
    }

    default: {
      return {status: 'created'}
    }
  }
}

function toListItem(task: TaskInfo): TaskListItem {
  const status: TaskListItemStatus = task.status ?? (task.completedAt ? 'completed' : task.startedAt ? 'started' : 'created')
  return {
    ...(task.completedAt ? {completedAt: task.completedAt} : {}),
    content: task.content,
    createdAt: task.createdAt,
    ...(task.error ? {error: task.error} : {}),
    ...(task.files && task.files.length > 0 ? {files: task.files} : {}),
    ...(task.folderPath ? {folderPath: task.folderPath} : {}),
    ...(task.model ? {model: task.model} : {}),
    ...(task.projectPath ? {projectPath: task.projectPath} : {}),
    ...(task.provider ? {provider: task.provider} : {}),
    ...(task.result ? {result: task.result} : {}),
    ...(task.startedAt ? {startedAt: task.startedAt} : {}),
    status,
    taskId: task.taskId,
    type: task.type,
  }
}

export class TaskRouter {
  /**
   * Throttle window for `onTaskUpdate` flushes — bursts of llmservice events
   * are coalesced into one save per window. 100ms keeps perceived latency low
   * while bounding write volume on chatty multi-step agents.
   */
  private static readonly FLUSH_INTERVAL_MS = 100
  private readonly agentPool: IAgentPool | undefined
  /**
   * Track recently completed tasks for grace period.
   * Allows late-arriving llmservice:* events to be routed even after task:completed.
   */
  private completedTasks: Map<string, {completedAt: number; task: TaskInfo}> = new Map()
  /** TaskIds with pending in-flight mutations awaiting the next throttled flush. */
  private readonly dirtyTaskIds: Set<string> = new Set()
  /** Pending throttle timer, if any. */
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly getAgentForProject: (projectPath?: string) => string | undefined
  private readonly getTaskHistoryStore: TaskRouterOptions['getTaskHistoryStore']
  private readonly lifecycleHooks: ITaskLifecycleHook[]
  private readonly preDispatchCheck: TaskRouterOptions['preDispatchCheck']
  private readonly projectRegistry: IProjectRegistry | undefined
  private readonly projectRouter: IProjectRouter | undefined
  private readonly resolveActiveProvider: TaskRouterOptions['resolveActiveProvider']
  private readonly resolveClientProjectPath: ((clientId: string) => string | undefined) | undefined
  /** Track active tasks */
  private tasks: Map<string, TaskInfo> = new Map()
  private readonly transport: ITransportServer

  constructor(options: TaskRouterOptions) {
    this.transport = options.transport
    this.agentPool = options.agentPool
    this.getAgentForProject = options.getAgentForProject
    this.getTaskHistoryStore = options.getTaskHistoryStore
    this.lifecycleHooks = options.lifecycleHooks ?? []
    this.preDispatchCheck = options.preDispatchCheck
    this.projectRegistry = options.projectRegistry
    this.projectRouter = options.projectRouter
    this.resolveActiveProvider = options.resolveActiveProvider
    this.resolveClientProjectPath = options.resolveClientProjectPath
  }

  clearTasks(): void {
    this.tasks.clear()
    this.completedTasks.clear()
    this.dirtyTaskIds.clear()
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
  }

  /**
   * Remove a task from tracking and send error to its client.
   * Used by ConnectionCoordinator when an agent disconnects.
   */
  failTask(taskId: string, error: {code?: string; message: string; name: string}): void {
    const task = this.tasks.get(taskId)
    if (!task) return

    this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {error, taskId})
    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task.projectPath,
      TransportTaskEventNames.ERROR,
      {error, taskId},
      task.clientId,
    )
    this.tasks.delete(taskId)

    // Notify hooks (fire-and-forget)
    this.notifyHooksError(taskId, error.message, task).catch(() => {})
  }

  getDebugState(): {
    activeTasks: Array<{clientId: string; createdAt: number; projectPath?: string; taskId: string; type: string}>
    completedTasks: Array<{completedAt: number; projectPath?: string; taskId: string; type: string}>
  } {
    return {
      activeTasks: [...this.tasks.values()].map((t) => ({
        clientId: t.clientId,
        createdAt: t.createdAt,
        projectPath: t.projectPath,
        taskId: t.taskId,
        type: t.type,
      })),
      completedTasks: [...this.completedTasks.entries()].map(([taskId, entry]) => ({
        completedAt: entry.completedAt,
        projectPath: entry.task.projectPath,
        taskId,
        type: entry.task.type,
      })),
    }
  }

  /**
   * Returns all active tasks for a given project path.
   * Used by ConnectionCoordinator to fail tasks on agent disconnect.
   */
  getTasksForProject(projectPath?: string): TaskInfo[] {
    const result: TaskInfo[] = []
    for (const task of this.tasks.values()) {
      if (projectPath === undefined) {
        // No projectPath specified — only match tasks without a project
        if (task.projectPath === undefined) {
          result.push(task)
        }
      } else if (task.projectPath === projectPath || task.projectPath === undefined) {
        // Specific project — match tasks for that project or unassigned tasks
        result.push(task)
      }
    }

    return result
  }

  /**
   * Register all task and LLM event handlers on the transport.
   */
  setup(): void {
    // Task creation from clients
    this.transport.onRequest<TaskCreateRequest, TaskCreateResponse>(TransportTaskEventNames.CREATE, (data, clientId) =>
      this.handleTaskCreate(data, clientId),
    )

    // Task cancellation from clients
    this.transport.onRequest<TaskCancelRequest, TaskCancelResponse>(TransportTaskEventNames.CANCEL, (data, clientId) =>
      this.handleTaskCancel(data, clientId),
    )

    // Snapshot query from clients (e.g. web UI Tasks tab)
    this.transport.onRequest<TaskListRequest, TaskListResponse>(TransportTaskEventNames.LIST, (data, clientId) =>
      this.handleTaskList(data, clientId),
    )

    // M2.09 — persistent-history handlers
    this.transport.onRequest<TaskGetRequest, TaskGetResponse>(TransportTaskEventNames.GET, (data, clientId) =>
      this.handleTaskGet(data, clientId),
    )
    this.transport.onRequest<TaskDeleteRequest, TaskDeleteResponse>(TransportTaskEventNames.DELETE, (data, clientId) =>
      this.handleTaskDelete(data, clientId),
    )
    this.transport.onRequest<TaskDeleteBulkRequest, TaskDeleteBulkResponse>(
      TransportTaskEventNames.DELETE_BULK,
      (data, clientId) => this.handleTaskDeleteBulk(data, clientId),
    )
    this.transport.onRequest<TaskClearCompletedRequest, TaskClearCompletedResponse>(
      TransportTaskEventNames.CLEAR_COMPLETED,
      (data, clientId) => this.handleTaskClearCompleted(data, clientId),
    )

    // Task lifecycle events from agent
    this.transport.onRequest<TaskStartedEvent, void>(TransportTaskEventNames.STARTED, (data) => {
      this.handleTaskStarted(data)
    })

    this.transport.onRequest<TaskCompletedEvent, void>(TransportTaskEventNames.COMPLETED, (data) => {
      this.handleTaskCompleted(data)
    })

    this.transport.onRequest<TaskErrorEvent, void>(TransportTaskEventNames.ERROR, (data) => {
      this.handleTaskError(data)
    })

    this.transport.onRequest<TaskCancelledEvent, void>(TransportTaskEventNames.CANCELLED, (data) => {
      this.handleTaskCancelled(data)
    })

    // LLM events
    for (const eventName of TransportLlmEventList) {
      this.registerLlmEvent(eventName)
    }
  }

  /**
   * Mutate the live `TaskInfo` from an `llmservice:*` event so a tab refresh
   * during the throttle window sees the in-flight state. Each branch:
   *   - thinking: push a `{isThinking: true, content: ''}` marker
   *   - chunk(reasoning): append to last item / flip empty marker / push fresh
   *   - chunk(text): IGNORED for persistence (transient stream)
   *   - response: set responseContent + sessionId (overwrite — multi-step keeps latest)
   *   - toolCall: push running entry
   *   - toolResult: update existing entry by callId
   *   - error / unsupportedInput: IGNORED (terminal hooks capture failure)
   *
   * Mutations use immutable `tasks.set(id, {...task, ...delta})` so consumers
   * holding a captured reference (e.g. notifyHooks*) see a stable snapshot.
   */
  private accumulateLlmEvent(taskId: string, eventName: string, data: {[key: string]: unknown}): void {
    const task = this.tasks.get(taskId)
    if (!task) return

    switch (eventName) {
      case LlmEventNames.CHUNK: {
        if (data.type !== 'reasoning') return // 'text' is transient — ignore
        const content = typeof data.content === 'string' ? data.content : ''
        const items = task.reasoningContents ?? []
        const last = items.at(-1)
        let nextItems: ReasoningContentItem[]
        if (last === undefined) {
          // Case C: empty array — push fresh body entry.
          nextItems = [{content, isThinking: false, timestamp: Date.now()}]
        } else if (last.isThinking === true && (last.content ?? '') === '') {
          // Case A: flip the empty isThinking marker to body.
          nextItems = [...items.slice(0, -1), {...last, content, isThinking: false}]
        } else {
          // Case B: append to existing body.
          nextItems = [...items.slice(0, -1), {...last, content: (last.content ?? '') + content}]
        }

        this.tasks.set(taskId, {...task, reasoningContents: nextItems})
        this.markDirty(taskId)
        return
      }

      case LlmEventNames.RESPONSE: {
        const content = typeof data.content === 'string' ? data.content : ''
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : task.sessionId
        this.tasks.set(taskId, {
          ...task,
          responseContent: content,
          ...(sessionId === undefined ? {} : {sessionId}),
        })
        this.markDirty(taskId)
        return
      }

      case LlmEventNames.THINKING: {
        const items = task.reasoningContents ?? []
        const nextItems: ReasoningContentItem[] = [
          ...items,
          {content: '', isThinking: true, timestamp: Date.now()},
        ]
        this.tasks.set(taskId, {...task, reasoningContents: nextItems})
        this.markDirty(taskId)
        return
      }

      case LlmEventNames.TOOL_CALL: {
        const args = typeof data.args === 'object' && data.args !== null ? (data.args as Record<string, unknown>) : {}
        const callId = typeof data.callId === 'string' ? data.callId : undefined
        const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
        const toolName = typeof data.toolName === 'string' ? data.toolName : ''
        const newCall: ToolCallEvent = {
          args,
          ...(callId === undefined ? {} : {callId}),
          sessionId,
          status: 'running',
          timestamp: Date.now(),
          toolName,
        }
        this.tasks.set(taskId, {
          ...task,
          toolCalls: [...(task.toolCalls ?? []), newCall],
        })
        this.markDirty(taskId)
        return
      }

      case LlmEventNames.TOOL_RESULT: {
        const callId = typeof data.callId === 'string' ? data.callId : undefined
        if (callId === undefined) return
        const items = task.toolCalls ?? []
        const idx = items.findIndex((c) => c.callId === callId)
        if (idx === -1) return
        const success = data.success !== false
        const updated: ToolCallEvent = {
          ...items[idx],
          ...(typeof data.error === 'string' ? {error: data.error} : {}),
          ...(typeof data.errorType === 'string' ? {errorType: data.errorType} : {}),
          ...(data.result === undefined ? {} : {result: data.result}),
          status: success ? 'completed' : 'error',
        }
        const nextCalls = [...items.slice(0, idx), updated, ...items.slice(idx + 1)]
        this.tasks.set(taskId, {...task, toolCalls: nextCalls})
        this.markDirty(taskId)
        break
      }

      // ERROR + UNSUPPORTED_INPUT: ignored — terminal lifecycle hook captures failure.
      default:
        // No mutation; fall through.
    }
  }

  /**
   * Emit `task:deleted` to the project room when a task is removed. Skips
   * silently when no projectPath is resolvable (broadcast wouldn't reach
   * any room). Clients that miss the broadcast will simply not see a row
   * disappear; they reconcile on next `task:list`.
   */
  private broadcastTaskDeleted(projectPath: string | undefined, taskId: string): void {
    if (projectPath === undefined) return
    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      projectPath,
      TransportTaskEventNames.DELETED,
      {taskId},
    )
  }

  /**
   * Drain the dirty set: for each taskId still active, fire `onTaskUpdate` on
   * each lifecycle hook. Tasks moved to `completedTasks` between markDirty
   * and flush are skipped — their terminal lifecycle hook already saved.
   */
  private async flushDirty(): Promise<void> {
    this.flushTimer = undefined
    if (this.dirtyTaskIds.size === 0) return

    const ids = [...this.dirtyTaskIds]
    this.dirtyTaskIds.clear()

    for (const taskId of ids) {
      const task = this.tasks.get(taskId)
      if (!task) continue
      for (const hook of this.lifecycleHooks) {
        try {
          // eslint-disable-next-line no-await-in-loop -- sequential hook calls by design
          await hook.onTaskUpdate?.(task)
        } catch (error) {
          transportLog(
            `LifecycleHook.onTaskUpdate error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
  }

  private handleTaskCancel(data: TaskCancelRequest, _clientId: string): TaskCancelResponse {
    const {taskId} = data

    transportLog(`Task cancel requested: ${taskId}`)

    const task = this.tasks.get(taskId)
    if (!task) {
      return {error: 'Task not found', success: false}
    }

    // If Agent connected for this task's project, forward cancel request
    const agentId = this.getAgentForProject(task.projectPath)
    if (agentId) {
      this.transport.sendTo(agentId, TransportTaskEventNames.CANCEL, {taskId})
      return {success: true}
    }

    // No Agent - cancel task locally and emit terminal event
    transportLog(`No Agent connected, cancelling task locally: ${taskId}`)
    this.transport.sendTo(task.clientId, TransportTaskEventNames.CANCELLED, {taskId})
    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task.projectPath,
      TransportTaskEventNames.CANCELLED,
      {taskId},
      task.clientId,
    )
    this.tasks.delete(taskId)
    this.notifyHooksCancelled(taskId, task).catch(() => {})

    return {success: true}
  }

  private handleTaskCancelled(data: TaskCancelledEvent): void {
    const {taskId} = data
    const existing = this.tasks.get(taskId)
    if (existing) {
      this.tasks.set(taskId, {...existing, completedAt: Date.now(), status: 'cancelled'})
    }

    const task = this.tasks.get(taskId)

    transportLog(`Task cancelled: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.CANCELLED, {taskId})
    }

    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task?.projectPath,
      TransportTaskEventNames.CANCELLED,
      {taskId},
      task?.clientId,
    )
    this.moveToCompleted(taskId)

    // Notify hooks (fire-and-forget)
    if (task) {
      this.notifyHooksCancelled(taskId, task).catch(() => {})
    }
  }

  private async handleTaskClearCompleted(
    data: TaskClearCompletedRequest,
    clientId: string,
  ): Promise<TaskClearCompletedResponse> {
    const projectFilter = data.projectPath ?? this.resolveClientProjectPath?.(clientId)
    if (projectFilter === undefined) return {deletedCount: 0}

    // In-memory: collect terminal completedTasks for the project.
    const inMemoryIds: string[] = []
    for (const [taskId, {task}] of this.completedTasks) {
      if (task.projectPath !== undefined && task.projectPath !== projectFilter) continue
      inMemoryIds.push(taskId)
    }

    // Persistent: clear matching terminal entries from disk (default statuses).
    let storeIds: string[] = []
    if (this.getTaskHistoryStore !== undefined) {
      try {
        const store = this.getTaskHistoryStore(projectFilter)
        const result = await store.clear({projectPath: projectFilter})
        storeIds = result.taskIds
      } catch (error) {
        transportLog(
          `handleTaskClearCompleted: store.clear failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        return {deletedCount: 0, error: 'task history store unavailable'}
      }
    }

    // Remove from in-memory.
    for (const taskId of inMemoryIds) this.completedTasks.delete(taskId)

    // Union + dedupe.
    const allIds = new Set<string>([...inMemoryIds, ...storeIds])
    for (const taskId of allIds) this.broadcastTaskDeleted(projectFilter, taskId)
    return {deletedCount: allIds.size}
  }

  private handleTaskCompleted(data: TaskCompletedEvent): void {
    const {logId: eventLogId, result, taskId} = data
    const existing = this.tasks.get(taskId)
    if (existing) {
      this.tasks.set(taskId, {...existing, completedAt: Date.now(), result, status: 'completed'})
    }

    const task = this.tasks.get(taskId)

    transportLog(`Task completed: ${taskId}`)

    // Collect synchronous completion data from hooks (e.g. pendingReviewCount from CurateLogHandler).
    // This runs before task:completed is emitted so the client receives everything atomically,
    // avoiding the race where review:notify would otherwise arrive after task:completed.
    const hookData: Record<string, unknown> = {}
    for (const hook of this.lifecycleHooks) {
      if (hook.getTaskCompletionData) {
        try {
          Object.assign(hookData, hook.getTaskCompletionData(taskId))
        } catch {
          // Best-effort: never block task:completed delivery
        }
      }
    }

    // Prefer logId from lifecycle hooks (curate), fall back to executor-provided logId (dream)
    const resolvedLogId = task?.logId ?? eventLogId

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.COMPLETED, {
        ...(resolvedLogId ? {logId: resolvedLogId} : {}),
        ...hookData,
        result,
        taskId,
      })
    }

    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task?.projectPath,
      TransportTaskEventNames.COMPLETED,
      {
        ...(resolvedLogId ? {logId: resolvedLogId} : {}),
        ...hookData,
        result,
        taskId,
      },
      task?.clientId,
    )
    this.moveToCompleted(taskId)

    // Notify pool so it can clear busy flag and drain queued tasks.
    // Fallback to data.projectPath for daemon-submitted tasks (e.g. idle dream)
    // that bypass handleTaskCreate and are not registered in this.tasks.
    const projectPath = task?.projectPath ?? data.projectPath
    if (projectPath) {
      this.agentPool?.notifyTaskCompleted(projectPath)
    }

    // Notify hooks (fire-and-forget)
    if (task) {
      this.notifyHooksCompleted(taskId, result, task).catch(() => {})
    }
  }

  /**
   * Handle task creation from a client.
   *
   * Ordering (critical for correctness):
   * 1. Idempotency check
   * 2. Early validation — on failure: send task:error, return. No task stored, no task:created, no hooks called.
   * 3. Store task + send task:created synchronously (before any await)
   * 4. Await lifecycle hooks → get logId
   *    Note: task:ack is intentionally delayed until hooks resolve so logId can be included.
   *    This reverses the old ordering (previously ack preceded created).
   * 5. Send task:ack with logId
   * 6. Submit to agentPool (fire-and-forget)
   */
  private async handleTaskCreate(data: TaskCreateRequest, clientId: string): Promise<TaskCreateResponse> {
    const {taskId} = data

    if (this.tasks.has(taskId)) {
      // Idempotent — duplicate creation returns existing taskId (e.g. client retry)
      return {taskId}
    }

    // ── Early validation: no hooks called if invalid ──────────────────────────

    if (!this.agentPool) {
      transportLog(`No AgentPool available, cannot process task ${taskId}`)
      const error = serializeTaskError(new AgentNotAvailableError())
      const projectPath = data.projectPath ?? this.resolveClientProjectPath?.(clientId) ?? data.clientCwd
      this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
      broadcastToProjectRoom(
        this.projectRegistry,
        this.projectRouter,
        projectPath,
        TransportTaskEventNames.ERROR,
        {error, taskId},
        clientId,
      )
      return {taskId}
    }

    if (!isValidTaskType(data.type)) {
      transportLog(`Invalid task type: ${data.type}`)
      const error = serializeTaskError(new Error(`Invalid task type: ${data.type}`))
      const projectPath = data.projectPath ?? this.resolveClientProjectPath?.(clientId) ?? data.clientCwd
      this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
      broadcastToProjectRoom(
        this.projectRegistry,
        this.projectRouter,
        projectPath,
        TransportTaskEventNames.ERROR,
        {error, taskId},
        clientId,
      )
      return {taskId}
    }

    // ── Resolve projectPath & worktreeRoot, store task synchronously ─────────

    let projectPath: string | undefined
    let worktreeRoot: string | undefined

    try {
      const taskContext = this.resolveTaskContext(data, clientId)
      if (taskContext.error) {
        const error = serializeTaskError(new Error(taskContext.error))
        this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
        broadcastToProjectRoom(
          this.projectRegistry,
          this.projectRouter,
          taskContext.projectPath,
          TransportTaskEventNames.ERROR,
          {error, taskId},
          clientId,
        )
        return {taskId}
      }

      projectPath = taskContext.projectPath
      worktreeRoot = taskContext.worktreeRoot
    } catch (error_) {
      const error = serializeTaskError(error_ instanceof Error ? error_ : new Error(String(error_)))
      const fallbackProjectPath = data.projectPath ?? this.resolveClientProjectPath?.(clientId) ?? data.clientCwd
      this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
      broadcastToProjectRoom(
        this.projectRegistry,
        this.projectRouter,
        fallbackProjectPath,
        TransportTaskEventNames.ERROR,
        {error, taskId},
        clientId,
      )
      return {taskId}
    }

    transportLog(`Task accepted: ${taskId} (type=${data.type}, client=${clientId})`)

    // Resolve active provider/model snapshot. Conditional await preserves the
    // synchronous "store → broadcast" timing when no resolver is configured —
    // an unconditional await would yield a microtask even on an immediately-
    // resolved Promise, breaking tests that assert on broadcasts without
    // awaiting the handler.
    const {model, provider} = this.resolveActiveProvider
      ? await this.safeResolveActiveProvider()
      : {}

    this.tasks.set(taskId, {
      clientId,
      content: data.content,
      createdAt: Date.now(),
      status: 'created',
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(data.folderPath ? {folderPath: data.folderPath} : {}),
      ...(model ? {model} : {}),
      ...(projectPath ? {projectPath} : {}),
      ...(provider ? {provider} : {}),
      taskId,
      type: data.type,
      ...(worktreeRoot ? {worktreeRoot} : {}),
    })

    // ── Send task:created synchronously (before any await) ────────────────────

    const createdPayload = {
      content: data.content,
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(data.folderPath ? {folderPath: data.folderPath} : {}),
      ...(model ? {model} : {}),
      ...(provider ? {provider} : {}),
      taskId,
      type: data.type,
    }
    this.transport.sendTo(clientId, TransportTaskEventNames.CREATED, createdPayload)

    // Broadcast to other clients in the project room (exclude creator to avoid duplicate)
    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      projectPath,
      TransportTaskEventNames.CREATED,
      createdPayload,
      clientId,
    )

    // ── Await lifecycle hooks ─────────────────────────────────────────────────

    const logId = await this.runCreateHooks(taskId)
    const task = this.tasks.get(taskId)
    if (task && logId) {
      this.tasks.set(taskId, {...task, logId})
    }

    // ── Send task:ack with logId ──────────────────────────────────────────────

    this.transport.sendTo(clientId, TransportTaskEventNames.ACK, {
      ...(logId ? {logId} : {}),
      taskId,
    })

    // ── Daemon-side pre-dispatch gate (dream uses this for gates 1-3) ────────
    // Runs after ack so the client has a logId to correlate; short-circuits with
    // task:completed + skip-reason when ineligible. Mirrors the idle-trigger
    // pattern in brv-server.ts:260 for the CLI dispatch path.

    if (this.preDispatchCheck) {
      let check: PreDispatchCheckResult = {eligible: true}
      try {
        check = await this.preDispatchCheck(data, projectPath)
      } catch (error_) {
        transportLog(
          `preDispatchCheck threw for task ${taskId}, proceeding with dispatch: ${error_ instanceof Error ? error_.message : String(error_)}`,
        )
      }

      if (!check.eligible) {
        transportLog(`Task ${taskId} (type=${data.type}) skipped by daemon pre-check: ${check.skipResult}`)
        // Use the skip-specific handler so the pool's activeTasks counter and
        // onTaskCompleted hooks aren't notified for a task that never reached
        // submitTask. See handleTaskSkippedByPreCheck for rationale.
        this.handleTaskSkippedByPreCheck(taskId, check.skipResult)
        return {taskId}
      }
    }

    // ── Submit to AgentPool (fire-and-forget) ─────────────────────────────────

    const executeMsg: TaskExecute = {
      clientId,
      content: data.content,
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(data.folderPath ? {folderPath: data.folderPath} : {}),
      ...(data.force === undefined ? {} : {force: data.force}),
      ...(projectPath ? {projectPath} : {}),
      taskId,
      type: data.type,
      ...(worktreeRoot ? {worktreeRoot} : {}),
    }

    // eslint-disable-next-line no-void
    void this.agentPool
      .submitTask(executeMsg)
      .then((submitResult) => {
        if (!submitResult.success) {
          transportLog(`AgentPool rejected task ${taskId}: ${submitResult.reason} — ${submitResult.message}`)
          const error = serializeTaskError(new Error(submitResult.message))
          const rejectedTask = this.tasks.get(taskId) ?? {
            clientId,
            content: data.content,
            createdAt: Date.now(),
            taskId,
            type: data.type,
          }
          this.tasks.delete(taskId)
          this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {
            ...(rejectedTask.logId ? {logId: rejectedTask.logId} : {}),
            error,
            taskId,
          })
          broadcastToProjectRoom(
            this.projectRegistry,
            this.projectRouter,
            projectPath,
            TransportTaskEventNames.ERROR,
            {
              ...(rejectedTask.logId ? {logId: rejectedTask.logId} : {}),
              error,
              taskId,
            },
            clientId,
          )
          this.notifyHooksError(taskId, submitResult.message, rejectedTask).catch(() => {})
        }
      })
      .catch((error_: unknown) => {
        transportLog(
          `AgentPool.submitTask threw unexpectedly for task ${taskId}: ${error_ instanceof Error ? error_.message : String(error_)}`,
        )
        const error = serializeTaskError(error_ instanceof Error ? error_ : new Error(String(error_)))
        const errorMsg = error_ instanceof Error ? error_.message : String(error_)
        const thrownTask = this.tasks.get(taskId) ?? {
          clientId,
          content: data.content,
          createdAt: Date.now(),
          taskId,
          type: data.type,
        }
        this.tasks.delete(taskId)
        this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {
          ...(thrownTask.logId ? {logId: thrownTask.logId} : {}),
          error,
          taskId,
        })
        broadcastToProjectRoom(
          this.projectRegistry,
          this.projectRouter,
          projectPath,
          TransportTaskEventNames.ERROR,
          {
            ...(thrownTask.logId ? {logId: thrownTask.logId} : {}),
            error,
            taskId,
          },
          clientId,
        )
        this.notifyHooksError(taskId, errorMsg, thrownTask).catch(() => {})
      })

    return {...(logId ? {logId} : {}), taskId}
  }

  private async handleTaskDelete(data: TaskDeleteRequest, clientId: string): Promise<TaskDeleteResponse> {
    const {taskId} = data

    // Refusal: non-terminal in-memory tasks must not be deleted out from under the agent.
    const liveTask = this.tasks.get(taskId)
    if (liveTask !== undefined) {
      const {status} = liveTask
      if (status !== undefined && !TERMINAL_STATUSES.has(status)) {
        return {error: `cannot delete task in status '${status}'`, success: false}
      }
    }

    // Resolve projectPath: in-memory first, then the client's registered project.
    const projectPath =
      liveTask?.projectPath ??
      this.completedTasks.get(taskId)?.task.projectPath ??
      this.resolveClientProjectPath?.(clientId)

    const wasInMemory = this.tasks.has(taskId) || this.completedTasks.has(taskId)
    this.tasks.delete(taskId)
    this.completedTasks.delete(taskId)

    let wasLive = false
    if (this.getTaskHistoryStore !== undefined && projectPath !== undefined) {
      try {
        const store = this.getTaskHistoryStore(projectPath)
        wasLive = await store.delete(taskId)
      } catch (error) {
        transportLog(
          `handleTaskDelete: store.delete failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (wasInMemory || wasLive) this.broadcastTaskDeleted(projectPath, taskId)
    return {success: true}
  }

  private async handleTaskDeleteBulk(
    data: TaskDeleteBulkRequest,
    clientId: string,
  ): Promise<TaskDeleteBulkResponse> {
    let deletedCount = 0
    for (const taskId of data.taskIds) {
      // eslint-disable-next-line no-await-in-loop -- per-id projectPath resolution is sequential
      const result = await this.handleTaskDelete({taskId}, clientId)
      if (result.success) deletedCount++
    }

    return {deletedCount}
  }

  private handleTaskError(data: TaskErrorEvent): void {
    const {error, taskId} = data
    const existing = this.tasks.get(taskId)
    if (existing) {
      this.tasks.set(taskId, {...existing, completedAt: Date.now(), error, status: 'error'})
    }

    const task = this.tasks.get(taskId)

    transportLog(`Task error: ${taskId} - [${error.code}] ${error.message}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {
        ...(task.logId ? {logId: task.logId} : {}),
        error,
        taskId,
      })
    }

    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task?.projectPath,
      TransportTaskEventNames.ERROR,
      {
        ...(task?.logId ? {logId: task.logId} : {}),
        error,
        taskId,
      },
      task?.clientId,
    )
    this.moveToCompleted(taskId)

    // Notify pool so it can clear busy flag and drain queued tasks.
    // Fallback to data.projectPath for daemon-submitted tasks (e.g. idle dream).
    const errorProjectPath = task?.projectPath ?? data.projectPath
    if (errorProjectPath) {
      this.agentPool?.notifyTaskCompleted(errorProjectPath)
    }

    // Notify hooks (fire-and-forget)
    if (task) {
      this.notifyHooksError(taskId, error.message, task).catch(() => {})
    }
  }

  private async handleTaskGet(data: TaskGetRequest, clientId: string): Promise<TaskGetResponse> {
    const {taskId} = data

    // Try in-memory active first
    const liveTask = this.tasks.get(taskId) ?? this.completedTasks.get(taskId)?.task
    if (liveTask !== undefined) {
      const synthesized = synthesizeEntryFromTaskInfo(liveTask)
      if (synthesized !== undefined) return {task: synthesized}
    }

    // Fall back to disk
    if (this.getTaskHistoryStore === undefined) return {task: null}
    const projectFilter = liveTask?.projectPath ?? this.resolveClientProjectPath?.(clientId)
    if (projectFilter === undefined) return {task: null}

    try {
      const store = this.getTaskHistoryStore(projectFilter)
      const entry = await store.getById(taskId)
      return {task: entry ?? null}
    } catch (error) {
      transportLog(
        `handleTaskGet: store.getById failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return {task: null}
    }
  }

  private async handleTaskList(data: TaskListRequest, clientId: string): Promise<TaskListResponse> {
    const projectFilter = data.projectPath ?? this.resolveClientProjectPath?.(clientId)

    // No resolvable project — return empty rather than leaking every task.
    // A client that hasn't registered a project shouldn't see other projects' work.
    if (projectFilter === undefined) return {tasks: []}

    const matches = (taskProject?: string): boolean =>
      taskProject === projectFilter || taskProject === undefined

    const limit = data.limit ?? DEFAULT_TASK_LIST_LIMIT
    const {before, status: statusFilter} = data

    // Persisted entries from the index (best-effort — tolerate store outages).
    let persisted: TaskListItem[] = []
    if (this.getTaskHistoryStore !== undefined) {
      try {
        const store = this.getTaskHistoryStore(projectFilter)
        const persistedStatuses = statusFilter as TaskHistoryStatus[] | undefined
        persisted = await store.list({
          projectPath: projectFilter,
          ...(before === undefined ? {} : {before}),
          ...(persistedStatuses === undefined ? {} : {status: persistedStatuses}),
        })
      } catch (error) {
        transportLog(
          `handleTaskList: store.list failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    // Build merge map (taskId → item). In-memory wins.
    const merged = new Map<string, TaskListItem>()
    for (const item of persisted) {
      if (matchesListFilters(item, {before, projectFilter, statusFilter})) merged.set(item.taskId, item)
    }

    for (const task of this.tasks.values()) {
      if (!matches(task.projectPath)) continue
      const item = toListItem(task)
      if (matchesListFilters(item, {before, projectFilter, statusFilter})) merged.set(item.taskId, item)
    }

    for (const {task} of this.completedTasks.values()) {
      if (!matches(task.projectPath)) continue
      const item = toListItem(task)
      if (matchesListFilters(item, {before, projectFilter, statusFilter})) merged.set(item.taskId, item)
    }

    const items = [...merged.values()].sort((a, b) => b.createdAt - a.createdAt)
    const paged = items.slice(0, limit)
    const hasMore = items.length > paged.length
    const nextCursor = hasMore && paged.length > 0 ? paged.at(-1)?.createdAt : undefined

    return nextCursor === undefined ? {tasks: paged} : {nextCursor, tasks: paged}
  }

  /**
   * Emit `task:completed` for a task that the daemon's pre-dispatch gate skipped
   * before it ever reached `AgentPool.submitTask`.
   *
   * Distinct from {@link handleTaskCompleted}:
   *   - does NOT call `agentPool.notifyTaskCompleted` (the pool's `activeTasks`
   *     counter was never incremented, so decrementing here would undercount real
   *     load and let `drainQueue` dispatch an extra queued task)
   *   - does NOT fire `onTaskCompleted` lifecycle hooks (counters/metrics that
   *     act on completed tasks should not see pre-check skips as completions)
   *
   * Still emits the event to the client and the project room so REPL/TUI
   * receive the skip result, and still calls `moveToCompleted` so the task is
   * removed from the active set.
   */
  private handleTaskSkippedByPreCheck(taskId: string, result: string): void {
    const task = this.tasks.get(taskId)

    transportLog(`Task skipped by pre-dispatch gate: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.COMPLETED, {
        result,
        taskId,
      })
    }

    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task?.projectPath,
      TransportTaskEventNames.COMPLETED,
      {result, taskId},
      task?.clientId,
    )
    this.moveToCompleted(taskId)
  }

  private handleTaskStarted(data: TaskStartedEvent): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.tasks.set(taskId, {...task, startedAt: Date.now(), status: 'started'})
      // No `onTaskStarted` hook — capture the transition via the throttled flush.
      this.markDirty(taskId)
      this.transport.sendTo(task.clientId, TransportTaskEventNames.STARTED, {taskId})

      broadcastToProjectRoom(
        this.projectRegistry,
        this.projectRouter,
        task.projectPath,
        TransportTaskEventNames.STARTED,
        {
          content: task.content,
          ...(task.clientCwd ? {clientCwd: task.clientCwd} : {}),
          ...(task.files?.length ? {files: task.files} : {}),
          taskId,
          type: task.type,
        },
        task.clientId,
      )
    } else {
      // No task context — cannot determine project room, skip broadcast
      transportLog(`Task started but no task context found: ${taskId}`)
    }
  }

  /**
   * Mark a taskId for the next throttled `onTaskUpdate` flush.
   * Schedules a timer if none is pending. Bursts of dirty marks within the
   * 100ms window coalesce into a single flush.
   */
  private markDirty(taskId: string): void {
    this.dirtyTaskIds.add(taskId)
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushDirty().catch(() => {
        // flushDirty already swallows per-hook errors; this catch covers
        // unexpected scheduler-level failures.
      })
    }, TaskRouter.FLUSH_INTERVAL_MS)
    // unref so a pending flush doesn't block daemon shutdown.
    this.flushTimer.unref?.()
  }

  /**
   * Move a task to the completed tasks map with grace period cleanup.
   */
  private moveToCompleted(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (task) {
      this.completedTasks.set(taskId, {completedAt: Date.now(), task})
      this.tasks.delete(taskId)

      setTimeout(() => {
        this.completedTasks.delete(taskId)
      }, TASK_CLEANUP_GRACE_PERIOD_MS)
    }
  }

  /**
   * Notify all hooks of task cancellation.
   * Each hook is called independently; errors are caught and logged.
   * cleanup() is called for each hook after onTaskCancelled.
   */
  private async notifyHooksCancelled(taskId: string, task: TaskInfo): Promise<void> {
    await Promise.allSettled(
      this.lifecycleHooks.map(async (hook) => {
        try {
          await hook.onTaskCancelled?.(taskId, task)
        } catch (error) {
          transportLog(
            `LifecycleHook.onTaskCancelled error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          hook.cleanup?.(taskId)
        }
      }),
    )
  }

  /**
   * Notify all hooks of task completion.
   * Each hook is called independently; errors are caught and logged.
   * cleanup() is called for each hook after onTaskCompleted.
   */
  private async notifyHooksCompleted(taskId: string, result: string, task: TaskInfo): Promise<void> {
    await Promise.allSettled(
      this.lifecycleHooks.map(async (hook) => {
        try {
          await hook.onTaskCompleted?.(taskId, result, task)
        } catch (error) {
          transportLog(
            `LifecycleHook.onTaskCompleted error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          hook.cleanup?.(taskId)
        }
      }),
    )
  }

  /**
   * Notify all hooks of task error.
   * Each hook is called independently; errors are caught and logged.
   * cleanup() is called for each hook after onTaskError.
   */
  private async notifyHooksError(taskId: string, errorMessage: string, task: TaskInfo): Promise<void> {
    await Promise.allSettled(
      this.lifecycleHooks.map(async (hook) => {
        try {
          await hook.onTaskError?.(taskId, errorMessage, task)
        } catch (error) {
          transportLog(
            `LifecycleHook.onTaskError error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          hook.cleanup?.(taskId)
        }
      }),
    )
  }

  private registerLlmEvent<E extends LlmEventName>(eventName: E): void {
    this.transport.onRequest<LlmEventPayloadMap[E], void>(eventName, (data) => {
      if (!hasTaskId(data)) return
      this.routeLlmEvent(eventName, data)
    })
  }

  private resolveTaskContext(
    data: TaskCreateRequest,
    clientId: string,
  ): {error?: string; projectPath?: string; worktreeRoot?: string} {
    // When both projectPath and worktreeRoot are explicitly provided,
    // skip the resolver entirely — a broken link under clientCwd must not
    // reject an otherwise valid explicit payload.
    if (data.projectPath && data.worktreeRoot) {
      if (!isDescendantOf(data.worktreeRoot, data.projectPath)) {
        return {
          error: `worktreeRoot "${data.worktreeRoot}" must be equal to or within projectPath "${data.projectPath}".`,
          projectPath: data.projectPath,
        }
      }

      return {projectPath: data.projectPath, worktreeRoot: data.worktreeRoot}
    }

    // Resolve from clientCwd (fresh, workspace-link-aware) when needed.
    let resolvedProjectPath: string | undefined
    let resolvedWorkspaceRoot: string | undefined

    if (data.clientCwd) {
      const resolution = resolveProject({cwd: data.clientCwd})
      resolvedProjectPath = resolution?.projectRoot
      resolvedWorkspaceRoot = resolution?.worktreeRoot
    }

    // Fallback order: explicit > fresh cwd resolution > stale registration > raw clientCwd.
    // Fresh resolution is preferred over registered path because the registered path
    // may be stale (e.g. in-flight reassociation after worktree add/remove).
    const registeredProjectPath = this.resolveClientProjectPath?.(clientId)
    const projectPath = data.projectPath ?? resolvedProjectPath ?? registeredProjectPath ?? data.clientCwd
    const worktreeRoot = data.worktreeRoot ?? resolvedWorkspaceRoot ?? projectPath

    if (projectPath && worktreeRoot && !isDescendantOf(worktreeRoot, projectPath)) {
      return {
        error: `worktreeRoot "${worktreeRoot}" must be equal to or within projectPath "${projectPath}".`,
        projectPath,
      }
    }

    return {projectPath, worktreeRoot}
  }

  /**
   * Generic handler for routing LLM events from Agent to clients.
   * Checks both active and recently completed tasks (within grace period).
   * onToolResult hooks are called only for ACTIVE tasks (not grace-period).
   */
  private routeLlmEvent(eventName: string, data: {[key: string]: unknown; taskId: string}): void {
    const {taskId, ...rest} = data
    const activeTask = this.tasks.get(taskId)
    const task = activeTask ?? this.completedTasks.get(taskId)?.task

    if (!task) {
      return
    }

    // Accumulator: mutate the live `TaskInfo` BEFORE broadcasting so a tab
    // refresh during the next throttle window sees the in-flight state.
    // Only mutates for ACTIVE tasks — grace-period entries already had their
    // terminal save persisted by the lifecycle hook.
    if (activeTask) {
      this.accumulateLlmEvent(taskId, eventName, data)
    }

    // Notify onToolResult hooks only for active tasks
    if (activeTask && eventName === LlmEventNames.TOOL_RESULT) {
      for (const hook of this.lifecycleHooks) {
        try {
          hook.onToolResult?.(taskId, data as unknown as LlmToolResultEvent)
        } catch (error) {
          transportLog(
            `LifecycleHook.onToolResult error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }

    this.transport.sendTo(task.clientId, eventName, {taskId, ...rest})
    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task.projectPath,
      eventName,
      {taskId, ...rest},
      task.clientId,
    )
  }

  /**
   * Run all onTaskCreate hooks and return the first logId.
   * Each hook is called independently; errors are caught and logged.
   */
  private async runCreateHooks(taskId: string): Promise<string | undefined> {
    if (this.lifecycleHooks.length === 0) return undefined

    const task = this.tasks.get(taskId)
    if (!task) return undefined

    const logIds = await Promise.all(
      this.lifecycleHooks.map(async (hook) => {
        if (!hook.onTaskCreate) return
        try {
          const result = await hook.onTaskCreate(task)
          return result?.logId
        } catch (error) {
          transportLog(
            `LifecycleHook.onTaskCreate error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }),
    )

    return logIds.find((id): id is string => typeof id === 'string')
  }

  /**
   * Invoke `resolveActiveProvider` with a try/catch so a thrown resolver
   * cannot block task dispatch. Returns `{}` when no resolver is configured
   * or when the resolver rejects/throws.
   */
  private async safeResolveActiveProvider(): Promise<{model?: string; provider?: string}> {
    if (!this.resolveActiveProvider) return {}
    try {
      return await this.resolveActiveProvider()
    } catch (error) {
      transportLog(`resolveActiveProvider failed: ${error instanceof Error ? error.message : String(error)}`)
      return {}
    }
  }
}
