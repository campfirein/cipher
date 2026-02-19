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
  TaskCompletedEvent,
  TaskCreateRequest,
  TaskCreateResponse,
  TaskErrorEvent,
  TaskExecute,
  TaskStartedEvent,
} from '../../core/domain/transport/schemas.js'
import type {IAgentPool} from '../../core/interfaces/agent/i-agent-pool.js'
import type {ITaskLifecycleHook} from '../../core/interfaces/process/i-task-lifecycle-hook.js'
import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../core/interfaces/routing/i-project-router.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {TaskInfo} from './types.js'

import {AgentNotAvailableError, serializeTaskError} from '../../core/domain/errors/task-error.js'
import {LlmEventNames, TransportLlmEventList, TransportTaskEventNames} from '../../core/domain/transport/schemas.js'
import {transportLog} from '../../utils/process-logger.js'
import {isValidTaskType} from '../../utils/type-guards.js'
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

/** Timeout for individual lifecycle hooks in onTaskCreate. */
const LIFECYCLE_HOOK_CREATE_TIMEOUT_MS = 2000

type TaskRouterOptions = {
  agentPool?: IAgentPool
  /** Function to resolve agent clientId for a given project */
  getAgentForProject: (projectPath?: string) => string | undefined
  /** Lifecycle hooks for task events (e.g. CurateLogHandler). */
  lifecycleHooks?: ITaskLifecycleHook[]
  projectRegistry?: IProjectRegistry
  projectRouter?: IProjectRouter
  /** Resolves the projectPath a client registered with (from client:register). */
  resolveClientProjectPath?: (clientId: string) => string | undefined
  transport: ITransportServer
}

function hasTaskId(data: unknown): data is {[key: string]: unknown; taskId: string} {
  return typeof data === 'object' && data !== null && 'taskId' in data && typeof data.taskId === 'string'
}

export class TaskRouter {
  private readonly agentPool: IAgentPool | undefined
  /**
   * Track recently completed tasks for grace period.
   * Allows late-arriving llmservice:* events to be routed even after task:completed.
   */
  private completedTasks: Map<string, {completedAt: number; task: TaskInfo}> = new Map()
  private readonly getAgentForProject: (projectPath?: string) => string | undefined
  private readonly lifecycleHooks: ITaskLifecycleHook[]
  private readonly projectRegistry: IProjectRegistry | undefined
  private readonly projectRouter: IProjectRouter | undefined
  private readonly resolveClientProjectPath: ((clientId: string) => string | undefined) | undefined
  /** Track active tasks */
  private tasks: Map<string, TaskInfo> = new Map()
  private readonly transport: ITransportServer

  constructor(options: TaskRouterOptions) {
    this.transport = options.transport
    this.agentPool = options.agentPool
    this.getAgentForProject = options.getAgentForProject
    this.lifecycleHooks = options.lifecycleHooks ?? []
    this.projectRegistry = options.projectRegistry
    this.projectRouter = options.projectRouter
    this.resolveClientProjectPath = options.resolveClientProjectPath
  }

  clearTasks(): void {
    this.tasks.clear()
    this.completedTasks.clear()
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

    return {success: true}
  }

  private handleTaskCancelled(data: TaskCancelledEvent): void {
    const {taskId} = data
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
      this.notifyHooksError(taskId, 'Task cancelled', task).catch(() => {})
    }
  }

  private handleTaskCompleted(data: TaskCompletedEvent): void {
    const {result, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task completed: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.COMPLETED, {
        ...(task.logId ? {logId: task.logId} : {}),
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

    // Notify pool so it can clear busy flag and drain queued tasks
    if (task?.projectPath) {
      this.agentPool?.notifyTaskCompleted(task.projectPath)
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
   * 2. Early validation (no hooks called on validation failures)
   * 3. Store task + send task:created synchronously (before any await)
   * 4. Await lifecycle hooks → get logId
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

    // ── Resolve projectPath & store task synchronously ────────────────────────

    // Resolve projectPath: explicit field > client's registered projectPath > clientCwd.
    // Client's registered projectPath is the walked-up project root (where .brv/ lives),
    // while clientCwd is the raw working directory (may be a subdirectory).
    const projectPath = data.projectPath ?? this.resolveClientProjectPath?.(clientId) ?? data.clientCwd

    transportLog(`Task accepted: ${taskId} (type=${data.type}, client=${clientId})`)

    this.tasks.set(taskId, {
      clientId,
      content: data.content,
      createdAt: Date.now(),
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(data.folderPath ? {folderPath: data.folderPath} : {}),
      ...(projectPath ? {projectPath} : {}),
      taskId,
      type: data.type,
    })

    // ── Send task:created synchronously (before any await) ────────────────────

    const createdPayload = {
      content: data.content,
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
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

    // ── Await lifecycle hooks (with timeout) ──────────────────────────────────

    const logId = await this.runCreateHooks(taskId)
    const task = this.tasks.get(taskId)
    if (task && logId) {
      task.logId = logId
    }

    // ── Send task:ack with logId ──────────────────────────────────────────────

    this.transport.sendTo(clientId, TransportTaskEventNames.ACK, {
      ...(logId ? {logId} : {}),
      taskId,
    })

    // ── Submit to AgentPool (fire-and-forget) ─────────────────────────────────

    const executeMsg: TaskExecute = {
      clientId,
      content: data.content,
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(data.folderPath ? {folderPath: data.folderPath} : {}),
      ...(projectPath ? {projectPath} : {}),
      taskId,
      type: data.type,
    }

    // eslint-disable-next-line no-void
    void this.agentPool
      .submitTask(executeMsg)
      .then((submitResult) => {
        if (!submitResult.success) {
          transportLog(`AgentPool rejected task ${taskId}: ${submitResult.reason} — ${submitResult.message}`)
          const error = serializeTaskError(new Error(submitResult.message))
          this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
          broadcastToProjectRoom(
            this.projectRegistry,
            this.projectRouter,
            projectPath,
            TransportTaskEventNames.ERROR,
            {error, taskId},
            clientId,
          )
          const rejectedTask = this.tasks.get(taskId) ?? {
            clientId,
            content: data.content,
            createdAt: Date.now(),
            taskId,
            type: data.type,
          }
          this.tasks.delete(taskId)
          this.notifyHooksError(taskId, submitResult.message, rejectedTask).catch(() => {})
        }
      })
      .catch((error_: unknown) => {
        transportLog(
          `AgentPool.submitTask threw unexpectedly for task ${taskId}: ${error_ instanceof Error ? error_.message : String(error_)}`,
        )
        const error = serializeTaskError(error_ instanceof Error ? error_ : new Error(String(error_)))
        this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
        broadcastToProjectRoom(
          this.projectRegistry,
          this.projectRouter,
          projectPath,
          TransportTaskEventNames.ERROR,
          {error, taskId},
          clientId,
        )
        const errorMsg = error_ instanceof Error ? error_.message : String(error_)
        const thrownTask = this.tasks.get(taskId) ?? {
          clientId,
          content: data.content,
          createdAt: Date.now(),
          taskId,
          type: data.type,
        }
        this.tasks.delete(taskId)
        this.notifyHooksError(taskId, errorMsg, thrownTask).catch(() => {})
      })

    return {...(logId ? {logId} : {}), taskId}
  }

  private handleTaskError(data: TaskErrorEvent): void {
    const {error, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task error: ${taskId} - [${error.code}] ${error.message}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {error, taskId})
    }

    broadcastToProjectRoom(
      this.projectRegistry,
      this.projectRouter,
      task?.projectPath,
      TransportTaskEventNames.ERROR,
      {error, taskId},
      task?.clientId,
    )
    this.moveToCompleted(taskId)

    // Notify pool so it can clear busy flag and drain queued tasks
    if (task?.projectPath) {
      this.agentPool?.notifyTaskCompleted(task.projectPath)
    }

    // Notify hooks (fire-and-forget)
    if (task) {
      this.notifyHooksError(taskId, error.message, task).catch(() => {})
    }
  }

  private handleTaskStarted(data: TaskStartedEvent): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)
    if (task) {
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
            `CurateLogHandler.onTaskCompleted error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          hook.cleanup?.(taskId)
        }
      }),
    )
  }

  /**
   * Notify all hooks of task error/cancellation.
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
            `CurateLogHandler.onTaskError error for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
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

    // Notify onToolResult hooks only for active tasks
    if (activeTask && eventName === LlmEventNames.TOOL_RESULT) {
      for (const hook of this.lifecycleHooks) {
        hook.onToolResult?.(taskId, data as unknown as LlmToolResultEvent)
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
   * Run all onTaskCreate hooks with a per-hook timeout.
   * Returns the first logId returned by any hook.
   * Timed-out hooks continue running in the background (their onTaskCompleted/onTaskError will finalize the entry).
   */
  private async runCreateHooks(taskId: string): Promise<string | undefined> {
    if (this.lifecycleHooks.length === 0) return undefined

    const task = this.tasks.get(taskId)
    if (!task) return undefined

    const TIMEOUT_SENTINEL = Symbol('timeout')

    const results = await Promise.all(
      this.lifecycleHooks.map(async (hook) => {
        if (!hook.onTaskCreate) return
        const result = await Promise.race([
          hook.onTaskCreate(task),
          new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
            setTimeout(() => resolve(TIMEOUT_SENTINEL), LIFECYCLE_HOOK_CREATE_TIMEOUT_MS)
          }),
        ])
        if (result === TIMEOUT_SENTINEL) return
        return (result as void | {logId?: string})?.logId
      }),
    )

    return results.find((r): r is string => typeof r === 'string')
  }
}
