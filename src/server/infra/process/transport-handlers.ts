/**
 * Transport Handlers - Message routing in Transport Process.
 *
 * Architecture v0.5.0:
 * - Routes messages between clients (TUI, external CLIs) and Agent
 * - Agent is a special client that registers via 'agent:register'
 * - Client UseCase generates taskId, Transport validates and routes
 * - NO TaskProcessor, NO business logic (just routing)
 *
 * Event naming convention:
 * - task:* events are Transport-generated (ack, created, started, completed, error)
 * - llmservice:* events are forwarded from Agent with ORIGINAL names
 *
 * Message flows:
 * 1. Client → Transport: task:create {taskId, type, content}
 *    Transport → Agent: task:execute {taskId, type, content, clientId}
 *    Transport → Client: task:ack {taskId}
 *    Transport → broadcast-room: task:created {taskId, type, content, files?}
 *
 * 2. Agent → Transport: llmservice:response {taskId, content}
 *    Transport → Client (direct): llmservice:response
 *    Transport → broadcast-room: llmservice:response (for TUI monitoring)
 *
 * 3. Agent → Transport: task:completed {taskId}
 *    Transport → Client (direct): task:completed
 *    Transport → broadcast-room: task:completed (for TUI monitoring)
 *
 * Special events:
 * - agent:register: Agent identifies itself
 * - agent:connected / agent:disconnected: Broadcast to all clients
 * - broadcast-room: TUI joins this room to monitor all events
 */

import type {ClientType} from '../../core/domain/client/client-info.js'
import type {
  AgentNewSessionRequest,
  AgentNewSessionResponse,
  AgentRestartRequest,
  AgentRestartResponse,
  AgentStatus,
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
import type {IClientManager} from '../../core/interfaces/client/i-client-manager.js'
import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../core/interfaces/routing/i-project-router.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {
  AgentDisconnectedError,
  AgentNotAvailableError,
  serializeTaskError,
} from '../../core/domain/errors/task-error.js'
import {
  AgentStatusEventNames,
  LlmEventNames,
  TransportAgentEventNames,
  TransportClientEventNames,
  TransportLlmEventList,
  TransportTaskEventNames,
} from '../../core/domain/transport/schemas.js'
import {eventLog, transportLog} from '../../utils/process-logger.js'
import {isValidTaskType} from '../../utils/type-guards.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Internal task tracking (local to TransportHandlers).
 */
type TaskInfo = {
  /** Client's working directory for file validation */
  clientCwd?: string
  clientId: string
  content: string
  createdAt: number
  files?: string[]
  /** Project path this task belongs to (for multi-project routing) */
  projectPath?: string
  taskId: string
  type: string
}

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

// All message types are imported from core/domain/transport/schemas.ts
// - TaskExecute: Transport → Agent (command)
// - TaskStartedEvent, TaskCompletedEvent, TaskErrorEvent: Agent → Transport (task lifecycle events)
// - LlmThinkingEvent, LlmChunkEvent, LlmResponseEvent, etc: Agent → Transport (LLM events)

// ============================================================================
// Constants
// ============================================================================

/**
 * Grace period (in ms) to keep completed tasks in memory for late-arriving events.
 * This prevents silent event drops when llmservice:* events arrive after task:completed.
 * Inspired by opencode's session callback queuing pattern.
 */
const TASK_CLEANUP_GRACE_PERIOD_MS = 5000

// ============================================================================
// Transport Handlers
// ============================================================================

/**
 * TransportHandlers - Routes messages between clients and Agent.
 *
 * This class is the "brain" of the Transport Process.
 * It knows which client is the Agent and routes messages accordingly.
 */
export class TransportHandlers {
  /**
   * Per-project agent tracking: projectPath → agentClientId.
   * Replaces single agentClientId for multi-project support.
   * When no projectPath is available (backward compat), uses empty string as key.
   */
  private agentClients: Map<string, string> = new Map()
  /** Agent pool for forked child process management */
  private readonly agentPool: IAgentPool | undefined
  /** Client lifecycle manager (optional — backward compatible) */
  private readonly clientManager: IClientManager | undefined
  /**
   * Track recently completed tasks for grace period.
   * Allows late-arriving llmservice:* events to be routed even after task:completed.
   * Key: taskId, Value: {task: TaskInfo, completedAt: timestamp}
   */
  private completedTasks: Map<string, {completedAt: number; task: TaskInfo}> = new Map()
  /** Project registry for resolving projectPath → sanitizedPath (optional) */
  private readonly projectRegistry: IProjectRegistry | undefined
  /** Project-scoped event router (used by T4 ClientManager for project room management) */
  private readonly projectRouter: IProjectRouter | undefined
  /** Track active tasks */
  private tasks: Map<string, TaskInfo> = new Map()
  /** Transport server reference */
  private readonly transport: ITransportServer

  constructor(options: {
    agentPool?: IAgentPool
    clientManager?: IClientManager
    projectRegistry?: IProjectRegistry
    projectRouter?: IProjectRouter
    transport: ITransportServer
  }) {
    this.transport = options.transport
    this.agentPool = options.agentPool
    this.projectRouter = options.projectRouter
    this.clientManager = options.clientManager
    this.projectRegistry = options.projectRegistry
  }

  /**
   * Cleanup handlers.
   */
  cleanup(): void {
    this.tasks.clear()
    this.completedTasks.clear()
    this.agentClients.clear()
  }

  /**
   * Returns a serializable snapshot of internal state for debugging.
   * Used by the daemon:getState handler in server-main.ts.
   */
  getDebugState(): {
    activeTasks: Array<{clientId: string; createdAt: number; projectPath?: string; taskId: string; type: string}>
    agentClients: Array<{clientId: string; projectPath: string}>
  } {
    return {
      activeTasks: [...this.tasks.values()].map((t) => ({
        clientId: t.clientId,
        createdAt: t.createdAt,
        projectPath: t.projectPath,
        taskId: t.taskId,
        type: t.type,
      })),
      agentClients: [...this.agentClients.entries()].map(([projectPath, clientId]) => ({
        clientId,
        projectPath,
      })),
    }
  }

  /**
   * Setup all message handlers.
   */
  setup(): void {
    this.setupConnectionHandlers()
    this.setupAgentHandlers()
    this.setupClientHandlers()
    this.setupClientLifecycleHandlers()
    this.setupAgentControlHandlers()
  }

  /**
   * Find which project a given agent client belongs to.
   * Reverse lookup in the agentClients map.
   */
  private findProjectForAgent(clientId: string): string | undefined {
    for (const [projectPath, agentId] of this.agentClients) {
      if (agentId === clientId) {
        // Empty string key means no projectPath (backward compat)
        return projectPath === '' ? undefined : projectPath
      }
    }

    return undefined
  }

  /**
   * Get the agent client ID for a given project.
   *
   * Lookup order:
   * 1. Exact match: agent registered for this specific projectPath
   * 2. Fallback: agent registered without projectPath (empty-string key, backward compat)
   * 3. Last resort: if no projectPath requested, return first available agent
   *
   * The fallback chain handles the transition period where tasks may have
   * projectPath but agents don't yet (M1 → M2 migration).
   */
  private getAgentForProject(projectPath?: string): string | undefined {
    // Exact match by project path
    if (projectPath) {
      const exact = this.agentClients.get(projectPath)
      if (exact) return exact
    }

    // Fallback: agent registered without projectPath (backward compat)
    if (this.agentClients.has('')) {
      return this.agentClients.get('')
    }

    // Last resort: if no projectPath requested, return first available agent
    if (!projectPath) {
      const first = this.agentClients.values().next()
      return first.done ? undefined : first.value
    }

    return undefined
  }

  /**
   * Get task info from either active or recently completed tasks.
   * Returns undefined if task is not found in either map.
   */
  private getTaskInfo(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId) ?? this.completedTasks.get(taskId)?.task
  }

  /**
   * Handle Agent registration.
   * Agent connects as Socket.IO client and sends 'agent:register'.
   * Fix #4: Accepts optional status in payload to cache atomically with registration.
   * T4: Accepts optional projectPath for multi-project agent routing.
   */
  private handleAgentRegister(clientId: string, data?: {projectPath?: string; status?: AgentStatus}): void {
    const projectPath = data?.projectPath
    transportLog(`Agent registered: ${clientId}${projectPath ? `, project=${projectPath}` : ''}`)

    // Track agent by project (empty string key for backward compat when no projectPath)
    const agentKey = projectPath ?? ''
    this.agentClients.set(agentKey, clientId)

    // Register with ClientManager if available
    if (this.clientManager) {
      this.clientManager.register(clientId, 'agent', projectPath)
    }

    // Add agent to project room if projectPath available
    if (projectPath && this.projectRouter && this.projectRegistry) {
      const projectInfo = this.projectRegistry.get(projectPath)
      if (projectInfo) {
        this.projectRouter.addToProjectRoom(clientId, projectInfo.sanitizedPath)
      }
    }

    // Broadcast to all clients that Agent is online
    this.transport.broadcast(TransportAgentEventNames.CONNECTED, {})
  }

  /**
   * Handle client:associateProject from global-scope MCP clients.
   * Binds a previously unassociated client to a project.
   * One-time operation — ignored if client already has a project.
   */
  private handleClientAssociateProject(
    clientId: string,
    data: {projectPath: string},
  ): {error?: string; success: boolean} {
    if (!this.clientManager) {
      return {error: 'ClientManager not available', success: false}
    }

    const client = this.clientManager.getClient(clientId)
    if (!client) {
      return {error: 'Client not registered', success: false}
    }

    if (client.hasProject) {
      // Already associated — no-op, return success
      return {success: true}
    }

    this.clientManager.associateProject(clientId, data.projectPath)
    transportLog(`Client ${clientId} associated with project ${data.projectPath}`)

    // Add to project room
    if (this.projectRouter && this.projectRegistry) {
      const projectInfo = this.projectRegistry.get(data.projectPath)
      if (projectInfo) {
        this.projectRouter.addToProjectRoom(clientId, projectInfo.sanitizedPath)
      }
    }

    return {success: true}
  }

  /**
   * Handle client:register from external clients (tui/cli/mcp).
   * Registers client in ClientManager and adds to project room if projectPath provided.
   */
  private handleClientRegister(
    clientId: string,
    data: {projectPath?: string; type: ClientType},
  ): {error?: string; success: boolean} {
    if (!this.clientManager) {
      return {error: 'ClientManager not available', success: false}
    }

    this.clientManager.register(clientId, data.type, data.projectPath)
    transportLog(`Client registered: ${clientId} (type=${data.type}${data.projectPath ? `, project=${data.projectPath}` : ''})`)

    // Add to project room if projectPath available
    if (data.projectPath && this.projectRouter && this.projectRegistry) {
      const projectInfo = this.projectRegistry.get(data.projectPath)
      if (projectInfo) {
        this.projectRouter.addToProjectRoom(clientId, projectInfo.sanitizedPath)
      }
    }

    return {success: true}
  }

  /**
   * Handle task:cancel request from client.
   * Returns success:false if task not found or Agent not available.
   * Emits task:cancelled terminal event when cancelled locally (no Agent).
   */
  private handleTaskCancel(data: TaskCancelRequest, _clientId: string): TaskCancelResponse {
    const {taskId} = data

    transportLog(`Task cancel requested: ${taskId}`)

    // Check if task exists
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

  /**
   * Handle task:cancelled from Agent.
   * Terminal event: task was cancelled before completion.
   * Route to task owner + broadcast-room, then cleanup with grace period.
   */
  private handleTaskCancelled(data: TaskCancelledEvent): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task cancelled: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.CANCELLED, {taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.CANCELLED, {taskId})
    // Move to completed tasks with grace period instead of immediate deletion
    this.moveToCompleted(taskId)
  }

  /**
   * Handle task:completed from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   * Uses grace period cleanup to allow late-arriving llmservice:* events.
   */
  private handleTaskCompleted(data: TaskCompletedEvent): void {
    const {result, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task completed: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.COMPLETED, {result, taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.COMPLETED, {result, taskId})
    // Move to completed tasks with grace period instead of immediate deletion
    // This allows late-arriving llmservice:* events to still be routed
    this.moveToCompleted(taskId)

    // Notify pool so it can clear busy flag and drain queued tasks
    if (task?.projectPath) {
      this.agentPool?.notifyTaskCompleted(task.projectPath)
    }
  }

  /**
   * Handle task:create request from client.
   * Validate taskId from client, add to tracking, forward to Agent.
   */
  private handleTaskCreate(data: TaskCreateRequest, clientId: string): TaskCreateResponse {
    const {taskId} = data

    // Duplicate check - reject if taskId already exists
    if (this.tasks.has(taskId)) {
      throw new Error(`Task ${taskId} already exists`)
    }

    transportLog(`Task accepted: ${taskId} (type=${data.type}, client=${clientId})`)

    // Track task (clientId used for direct messaging)
    this.tasks.set(taskId, {
      clientId,
      content: data.content,
      createdAt: Date.now(),
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      ...(data.projectPath ? {projectPath: data.projectPath} : {}),
      taskId,
      type: data.type,
    })

    // Send ack immediately (fast feedback)
    this.transport.sendTo(clientId, TransportTaskEventNames.ACK, {taskId})

    // Broadcast task:created to broadcast-room for TUI monitoring
    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.CREATED, {
      content: data.content,
      ...(data.clientCwd ? {clientCwd: data.clientCwd} : {}),
      ...(data.files?.length ? {files: data.files} : {}),
      taskId,
      type: data.type,
    })

    // All tasks go through AgentPool (which forks child processes)
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
      ...(data.projectPath ? {projectPath: data.projectPath} : {}),
      taskId,
      type: data.type,
    }

    // Fire-and-forget — agent child process routes events back via transport
    // eslint-disable-next-line no-void
    void this.agentPool.submitTask(executeMsg).then((result) => {
      if (!result.success) {
        transportLog(`AgentPool rejected task ${taskId}: ${result.reason} — ${result.message}`)
        const error = serializeTaskError(new Error(result.message))
        this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
        this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
        this.tasks.delete(taskId)
      }
    })

    return {taskId}
  }

  /**
   * Handle task:error from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   * Uses grace period cleanup to allow late-arriving llmservice:* events.
   */
  private handleTaskError(data: TaskErrorEvent): void {
    const {error, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task error: ${taskId} - [${error.code}] ${error.message}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {error, taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
    // Move to completed tasks with grace period instead of immediate deletion
    this.moveToCompleted(taskId)

    // Notify pool so it can clear busy flag and drain queued tasks
    if (task?.projectPath) {
      this.agentPool?.notifyTaskCompleted(task.projectPath)
    }
  }

  /**
   * Handle task:started from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleTaskStarted(data: TaskStartedEvent): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.STARTED, {taskId})

      // Broadcast with task info for monitoring
      // Note: fileReferenceInstructions is generated by UseCase during execution,
      // so it's not available at task:started time. It's saved to DB instead.
      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.STARTED, {
        content: task.content,
        ...(task.clientCwd ? {clientCwd: task.clientCwd} : {}),
        ...(task.files?.length ? {files: task.files} : {}),
        taskId,
        type: task.type,
      })
    } else {
      // Fallback if task not found
      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.STARTED, {taskId})
    }
  }

  /**
   * Check if a given client ID is a registered agent.
   */
  private isAgentClient(clientId: string): boolean {
    for (const agentId of this.agentClients.values()) {
      if (agentId === clientId) return true
    }

    return false
  }

  /**
   * Move a task to the completed tasks map with grace period cleanup.
   * This allows late-arriving llmservice:* events to still be routed.
   */
  private moveToCompleted(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (task) {
      this.completedTasks.set(taskId, {completedAt: Date.now(), task})
      this.tasks.delete(taskId)

      // Schedule cleanup after grace period
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
   * Remove an agent client from the agentClients map.
   */
  private removeAgentClient(clientId: string): void {
    for (const [projectPath, agentId] of this.agentClients) {
      if (agentId === clientId) {
        this.agentClients.delete(projectPath)
        break
      }
    }
  }

  /**
   * Generic handler for routing LLM events from Agent to clients.
   * Routes directly to task owner + broadcast-room for monitoring.
   *
   * All llmservice:* events follow the same routing pattern:
   * 1. Extract taskId from payload
   * 2. Check if task is active OR recently completed (within grace period)
   * 3. Send to task owner + broadcast-room if found
   * 4. Drop silently if task not found (truly ended beyond grace period)
   *
   * The grace period allows late-arriving events (due to network delays or
   * out-of-order delivery) to still be routed to clients.
   */
  private routeLlmEvent(eventName: string, data: {[key: string]: unknown; taskId: string}): void {
    const {taskId, ...rest} = data
    // Use getTaskInfo to check both active and recently completed tasks
    const task = this.getTaskInfo(taskId)

    // Guard: Drop events for tasks not found in either active or completed maps
    if (!task) {
      return
    }

    this.transport.sendTo(task.clientId, eventName, {taskId, ...rest})
    this.transport.broadcastTo('broadcast-room', eventName, {taskId, ...rest})
  }

  /**
   * Setup agent control handlers.
   * These handle commands to control the Agent process (restart, etc.)
   */
  private setupAgentControlHandlers(): void {
    // agent:restart - Client requests Agent to reinitialize
    this.transport.onRequest<AgentRestartRequest, AgentRestartResponse>(
      TransportAgentEventNames.RESTART,
      (data, clientId) => {
        transportLog(`Agent restart requested by ${clientId}: ${data.reason ?? 'no reason'}`)

        const agentId = this.getAgentForProject()
        if (!agentId) {
          return {error: 'Agent not connected', success: false}
        }

        // Forward restart command to Agent
        this.transport.sendTo(agentId, TransportAgentEventNames.RESTART, {reason: data.reason})

        // Broadcast and log event
        eventLog('agent:restarting', {reason: data.reason})
        this.transport.broadcast(TransportAgentEventNames.RESTARTING, {reason: data.reason})

        return {success: true}
      },
    )

    // agent:restarted - Agent reports restart result
    this.transport.onRequest<{error?: string; success: boolean}, void>(TransportAgentEventNames.RESTARTED, (data) => {
      if (data.success) {
        transportLog('Agent restarted successfully')
        eventLog('agent:restarted', {success: true})
        this.transport.broadcast(TransportAgentEventNames.RESTARTED, {success: true})
      } else {
        transportLog(`Agent restart failed: ${data.error}`)
        eventLog('agent:restarted', {error: data.error, success: false})
        this.transport.broadcast(TransportAgentEventNames.RESTARTED, {error: data.error, success: false})
      }
    })

    // agent:newSession - Client requests a new session (ends current, starts fresh)
    this.transport.onRequest<AgentNewSessionRequest, AgentNewSessionResponse>(
      TransportAgentEventNames.NEW_SESSION,
      (data, clientId) => {
        transportLog(`New session requested by ${clientId}: ${data.reason ?? 'no reason'}`)

        const agentId = this.getAgentForProject()
        if (!agentId) {
          return {error: 'Agent not connected', success: false}
        }

        // Forward new session command to Agent
        this.transport.sendTo(agentId, TransportAgentEventNames.NEW_SESSION, {reason: data.reason})

        // The actual response will come via agent:newSessionCreated event
        // For now, return success to indicate the request was forwarded
        return {success: true}
      },
    )

    // agent:newSessionCreated - Agent reports new session creation result
    this.transport.onRequest<AgentNewSessionResponse, void>(
      TransportAgentEventNames.NEW_SESSION_CREATED,
      (data) => {
        if (data.success) {
          transportLog(`New session created: ${data.sessionId}`)
          eventLog('agent:newSessionCreated', {sessionId: data.sessionId, success: true})
          this.transport.broadcast(TransportAgentEventNames.NEW_SESSION_CREATED, {
            sessionId: data.sessionId,
            success: true,
          })
        } else {
          transportLog(`New session creation failed: ${data.error}`)
          eventLog('agent:newSessionCreated', {error: data.error, success: false})
          this.transport.broadcast(TransportAgentEventNames.NEW_SESSION_CREATED, {
            error: data.error,
            success: false,
          })
        }
      },
    )
  }

  /**
   * Setup Agent-related handlers.
   * These handle events FROM the Agent.
   */
  private setupAgentHandlers(): void {
    // Agent registration
    // Fix #4: Accept optional status in payload for atomic caching
    // T4: Accept optional projectPath for multi-project routing
    this.transport.onRequest<{projectPath?: string; status?: AgentStatus}, {success: boolean}>(
      TransportAgentEventNames.REGISTER,
      (data, clientId) => {
        this.handleAgentRegister(clientId, data)
        return {success: true}
      },
    )

    // Task lifecycle events (Transport-generated names)
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

    // LLM events - explicit list + typed payload map
    for (const eventName of TransportLlmEventList) {
      this.registerLlmEvent(eventName)
    }

    // Agent status events
    // agent:status:changed - Agent broadcasts status changes
    this.transport.onRequest<AgentStatus, void>(AgentStatusEventNames.STATUS_CHANGED, (data) => {
      transportLog(
        `Agent status changed: initialized=${data.isInitialized}, auth=${data.hasAuth}, config=${data.hasConfig}`,
      )
      // Broadcast status change to all clients
      this.transport.broadcast(AgentStatusEventNames.STATUS_CHANGED, data)
    })
  }

  /**
   * Setup client-related handlers.
   * These handle events FROM clients (TUI, external CLIs).
   */
  private setupClientHandlers(): void {
    // Task creation from clients
    this.transport.onRequest<TaskCreateRequest, TaskCreateResponse>(TransportTaskEventNames.CREATE, (data, clientId) =>
      this.handleTaskCreate(data, clientId),
    )

    // Task cancellation from clients
    this.transport.onRequest<TaskCancelRequest, TaskCancelResponse>(TransportTaskEventNames.CANCEL, (data, clientId) =>
      this.handleTaskCancel(data, clientId),
    )
  }

  /**
   * Setup client lifecycle handlers (client:register, client:associateProject).
   * These handle registration of external clients (tui/cli/mcp) and
   * lazy project association for global-scope MCP clients.
   */
  private setupClientLifecycleHandlers(): void {
    // client:register — external client identifies itself and optionally provides projectPath
    this.transport.onRequest<{projectPath?: string; type: ClientType}, {error?: string; success: boolean}>(
      TransportClientEventNames.REGISTER,
      (data, clientId) => this.handleClientRegister(clientId, data),
    )

    // client:associateProject — global-scope MCP client binds to a project after first tool call
    this.transport.onRequest<{projectPath: string}, {error?: string; success: boolean}>(
      TransportClientEventNames.ASSOCIATE_PROJECT,
      (data, clientId) => this.handleClientAssociateProject(clientId, data),
    )
  }

  /**
   * Setup connection event handlers.
   */
  private setupConnectionHandlers(): void {
    this.transport.onConnection((clientId, _metadata) => {
      transportLog(`Client connected: ${clientId}`)
    })

    this.transport.onDisconnection((clientId, _metadata) => {
      transportLog(`Client disconnected: ${clientId}`)

      // Check if this is a registered agent
      if (this.isAgentClient(clientId)) {
        const projectPath = this.findProjectForAgent(clientId)
        transportLog(`Agent disconnected!${projectPath ? ` project=${projectPath}` : ''}`)

        // Remove agent from tracking
        this.removeAgentClient(clientId)

        // Remove from project room
        if (projectPath && this.projectRouter && this.projectRegistry) {
          const projectInfo = this.projectRegistry.get(projectPath)
          if (projectInfo) {
            this.projectRouter.removeFromProjectRoom(clientId, projectInfo.sanitizedPath)
          }
        }

        // Broadcast to all clients
        this.transport.broadcast(TransportAgentEventNames.DISCONNECTED, {})

        // Fail only tasks belonging to the disconnected agent's project
        const error = serializeTaskError(new AgentDisconnectedError())
        const taskIdsToRemove: string[] = []
        for (const [taskId, task] of this.tasks) {
          if (!projectPath || task.projectPath === projectPath || task.projectPath === undefined) {
            this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {error, taskId})
            this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
            taskIdsToRemove.push(taskId)
          }
        }

        for (const taskId of taskIdsToRemove) {
          this.tasks.delete(taskId)
        }
      }

      // Unregister from ClientManager (handles onProjectEmpty callback)
      if (this.clientManager) {
        const client = this.clientManager.getClient(clientId)
        // Remove from project room if client was associated with a project
        if (client?.projectPath && this.projectRouter && this.projectRegistry) {
          const projectInfo = this.projectRegistry.get(client.projectPath)
          if (projectInfo) {
            this.projectRouter.removeFromProjectRoom(clientId, projectInfo.sanitizedPath)
          }
        }

        this.clientManager.unregister(clientId)
      }
    })
  }
}
