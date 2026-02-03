/**
 * TaskRouter - Routes task and LLM events between clients and agents.
 *
 * Handles:
 * - Task lifecycle: create → ack → started → completed/error/cancelled
 * - LLM event routing: llmservice:* events from agent → client + broadcast-room
 * - Grace period: keeps completed tasks briefly for late-arriving LLM events
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
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {TaskInfo} from './types.js'

import {
  AgentNotAvailableError,
  serializeTaskError,
} from '../../core/domain/errors/task-error.js'
import {
  LlmEventNames,
  TransportLlmEventList,
  TransportTaskEventNames,
} from '../../core/domain/transport/schemas.js'
import {transportLog} from '../../utils/process-logger.js'
import {isValidTaskType} from '../../utils/type-guards.js'

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

type TaskRouterOptions = {
  agentPool?: IAgentPool
  /** Function to resolve agent clientId for a given project */
  getAgentForProject: (projectPath?: string) => string | undefined
  transport: ITransportServer
}

export class TaskRouter {
  private readonly agentPool: IAgentPool | undefined
  /**
   * Track recently completed tasks for grace period.
   * Allows late-arriving llmservice:* events to be routed even after task:completed.
   */
  private completedTasks: Map<string, {completedAt: number; task: TaskInfo}> = new Map()
  private readonly getAgentForProject: (projectPath?: string) => string | undefined
  /** Track active tasks */
  private tasks: Map<string, TaskInfo> = new Map()
  private readonly transport: ITransportServer

  constructor(options: TaskRouterOptions) {
    this.transport = options.transport
    this.agentPool = options.agentPool
    this.getAgentForProject = options.getAgentForProject
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
    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
    this.tasks.delete(taskId)
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
      if (!projectPath || task.projectPath === projectPath || task.projectPath === undefined) {
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
    this.transport.onRequest<TaskCreateRequest, TaskCreateResponse>(
      TransportTaskEventNames.CREATE,
      (data, clientId) => this.handleTaskCreate(data, clientId),
    )

    // Task cancellation from clients
    this.transport.onRequest<TaskCancelRequest, TaskCancelResponse>(
      TransportTaskEventNames.CANCEL,
      (data, clientId) => this.handleTaskCancel(data, clientId),
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
    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.CANCELLED, {taskId})
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

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.CANCELLED, {taskId})
    this.moveToCompleted(taskId)
  }

  private handleTaskCompleted(data: TaskCompletedEvent): void {
    const {result, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task completed: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.COMPLETED, {result, taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.COMPLETED, {result, taskId})
    this.moveToCompleted(taskId)

    // Notify pool so it can clear busy flag and drain queued tasks
    if (task?.projectPath) {
      this.agentPool?.notifyTaskCompleted(task.projectPath)
    }
  }

  private handleTaskCreate(data: TaskCreateRequest, clientId: string): TaskCreateResponse {
    const {taskId} = data

    if (this.tasks.has(taskId)) {
      throw new Error(`Task ${taskId} already exists`)
    }

    // Resolve projectPath: explicit field takes priority, fall back to clientCwd.
    const projectPath = data.projectPath ?? data.clientCwd

    transportLog(`Task accepted: ${taskId} (type=${data.type}, client=${clientId})`)

    this.tasks.set(taskId, {
      clientId,
      content: data.content,
      createdAt: Date.now(),
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(projectPath ? {projectPath} : {}),
      taskId,
      type: data.type,
    })

    // Send ack immediately
    this.transport.sendTo(clientId, TransportTaskEventNames.ACK, {taskId})

    // Broadcast task:created to broadcast-room for TUI monitoring
    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.CREATED, {
      content: data.content,
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      taskId,
      type: data.type,
    })

    // All tasks go through AgentPool
    if (!this.agentPool) {
      transportLog(`No AgentPool available, cannot process task ${taskId}`)
      const error = serializeTaskError(new AgentNotAvailableError())
      this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
      this.tasks.delete(taskId)
      return {taskId}
    }

    // Validate task type before submitting
    if (!isValidTaskType(data.type)) {
      transportLog(`Invalid task type: ${data.type}`)
      const error = serializeTaskError(new Error(`Invalid task type: ${data.type}`))
      this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
      this.tasks.delete(taskId)
      return {taskId}
    }

    const executeMsg: TaskExecute = {
      clientId,
      content: data.content,
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(projectPath ? {projectPath} : {}),
      taskId,
      type: data.type,
    }

    // Fire-and-forget — agent child process routes events back via transport
    // eslint-disable-next-line no-void
    void this.agentPool.submitTask(executeMsg).then((submitResult) => {
      if (!submitResult.success) {
        transportLog(`AgentPool rejected task ${taskId}: ${submitResult.reason} — ${submitResult.message}`)
        const error = serializeTaskError(new Error(submitResult.message))
        this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
        this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
        this.tasks.delete(taskId)
      }
    }).catch((error_: unknown) => {
      transportLog(`AgentPool.submitTask threw unexpectedly for task ${taskId}: ${error_ instanceof Error ? error_.message : String(error_)}`)
      const error = serializeTaskError(error_ instanceof Error ? error_ : new Error(String(error_)))
      this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
      this.tasks.delete(taskId)
    })

    return {taskId}
  }

  private handleTaskError(data: TaskErrorEvent): void {
    const {error, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task error: ${taskId} - [${error.code}] ${error.message}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {error, taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
    this.moveToCompleted(taskId)

    // Notify pool so it can clear busy flag and drain queued tasks
    if (task?.projectPath) {
      this.agentPool?.notifyTaskCompleted(task.projectPath)
    }
  }

  private handleTaskStarted(data: TaskStartedEvent): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.STARTED, {taskId})

      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.STARTED, {
        content: task.content,
        ...(task.clientCwd ? {clientCwd: task.clientCwd} : {}),
        ...(task.files?.length ? {files: task.files} : {}),
        taskId,
        type: task.type,
      })
    } else {
      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.STARTED, {taskId})
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

  private registerLlmEvent<E extends LlmEventName>(eventName: E): void {
    this.transport.onRequest<LlmEventPayloadMap[E], void>(eventName, (data) => {
      this.routeLlmEvent(eventName, data as unknown as {[key: string]: unknown; taskId: string})
    })
  }

  /**
   * Generic handler for routing LLM events from Agent to clients.
   * Checks both active and recently completed tasks (within grace period).
   */
  private routeLlmEvent(eventName: string, data: {[key: string]: unknown; taskId: string}): void {
    const {taskId, ...rest} = data
    const task = this.tasks.get(taskId) ?? this.completedTasks.get(taskId)?.task

    if (!task) {
      return
    }

    this.transport.sendTo(task.clientId, eventName, {taskId, ...rest})
    this.transport.broadcastTo('broadcast-room', eventName, {taskId, ...rest})
  }
}
