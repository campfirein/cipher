/**
 * Transport Handlers - Message routing in Transport Process.
 *
 * Architecture v0.5.0:
 * - Routes messages between clients (TUI, external CLIs) and Agent
 * - Agent is a special client that registers via 'agent:register'
 * - Transport generates taskId, tracks clientId for direct messaging
 * - NO TaskProcessor, NO business logic (just routing)
 *
 * Event naming convention:
 * - task:* events are Transport-generated (ack, created, started, completed, error)
 * - llmservice:* events are forwarded from Agent with ORIGINAL names
 *
 * Message flows:
 * 1. Client → Transport: task:create {type, content}
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

import {randomUUID} from 'node:crypto'

import type {
  AgentRestartRequest,
  AgentRestartResponse,
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
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {
  AgentDisconnectedError,
  AgentNotAvailableError,
  serializeTaskError,
} from '../../core/domain/errors/task-error.js'
import {
  LlmEventNames,
  TransportAgentEventNames,
  TransportLlmEventList,
  TransportTaskEventNames,
} from '../../core/domain/transport/schemas.js'
import {eventLog, transportLog} from '../../utils/process-logger.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Internal task tracking (local to TransportHandlers).
 */
type TaskInfo = {
  clientId: string
  content: string
  createdAt: number
  files?: string[]
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
// Transport Handlers
// ============================================================================

/**
 * TransportHandlers - Routes messages between clients and Agent.
 *
 * This class is the "brain" of the Transport Process.
 * It knows which client is the Agent and routes messages accordingly.
 */
export class TransportHandlers {
  /** The Agent's client ID (set when Agent registers) */
  private agentClientId: string | undefined
  /** Track active tasks */
  private tasks: Map<string, TaskInfo> = new Map()
  /** Transport server reference */
  private readonly transport: ITransportServer

  constructor(transport: ITransportServer) {
    this.transport = transport
  }

  /**
   * Cleanup handlers.
   */
  cleanup(): void {
    this.tasks.clear()
    this.agentClientId = undefined
  }

  /**
   * Setup all message handlers.
   */
  setup(): void {
    this.setupConnectionHandlers()
    this.setupAgentHandlers()
    this.setupClientHandlers()
    this.setupAgentControlHandlers()
  }

  /**
   * Handle Agent registration.
   * Agent connects as Socket.IO client and sends 'agent:register'.
   */
  private handleAgentRegister(clientId: string): void {
    transportLog(`Agent registered: ${clientId}`)
    this.agentClientId = clientId

    // Broadcast to all clients that Agent is online
    this.transport.broadcast(TransportAgentEventNames.CONNECTED, {})
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

    // If Agent connected, forward cancel request
    if (this.agentClientId) {
      this.transport.sendTo(this.agentClientId, TransportTaskEventNames.CANCEL, {taskId})
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
   * Route to task owner + broadcast-room, then cleanup.
   */
  private handleTaskCancelled(data: TaskCancelledEvent): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task cancelled: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.CANCELLED, {taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.CANCELLED, {taskId})
    this.tasks.delete(taskId)
  }

  /**
   * Handle task:completed from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleTaskCompleted(data: TaskCompletedEvent): void {
    const {result, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task completed: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.COMPLETED, {result, taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.COMPLETED, {result, taskId})
    this.tasks.delete(taskId)
  }

  /**
   * Handle task:create request from client.
   * Generate taskId, add client to room, forward to Agent.
   */
  private handleTaskCreate(data: TaskCreateRequest, clientId: string): TaskCreateResponse {
    const taskId = randomUUID()

    transportLog(`Task created: ${taskId} (type=${data.type}, client=${clientId})`)

    // Track task (clientId used for direct messaging)
    this.tasks.set(taskId, {
      clientId,
      content: data.content,
      createdAt: Date.now(),
      ...(data.files?.length ? {files: data.files} : {}),
      taskId,
      type: data.type,
    })

    // Send ack immediately (fast feedback)
    this.transport.sendTo(clientId, TransportTaskEventNames.ACK, {taskId})

    // Broadcast task:created to broadcast-room for TUI monitoring
    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.CREATED, {
      content: data.content,
      ...(data.files?.length ? {files: data.files} : {}),
      taskId,
      type: data.type,
    })

    // Forward to Agent
    if (this.agentClientId) {
      const executeMsg: TaskExecute = {
        clientId,
        content: data.content,
        ...(data.files?.length ? {files: data.files} : {}),
        taskId,
        type: data.type as 'curate' | 'query',
      }
      this.transport.sendTo(this.agentClientId, TransportTaskEventNames.EXECUTE, executeMsg)
    } else {
      // No Agent connected - send error to client AND broadcast-room, then cleanup
      console.warn(`[Transport] No Agent connected, cannot process task ${taskId}`)
      const error = serializeTaskError(new AgentNotAvailableError())
      setTimeout(() => {
        this.transport.sendTo(clientId, TransportTaskEventNames.ERROR, {error, taskId})
        this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
        this.tasks.delete(taskId)
      }, 100)
    }

    return {taskId}
  }

  /**
   * Handle task:error from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleTaskError(data: TaskErrorEvent): void {
    const {error, taskId} = data
    const task = this.tasks.get(taskId)

    transportLog(`Task error: ${taskId} - [${error.code}] ${error.message}`)

    if (task) {
      this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {error, taskId})
    }

    this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
    this.tasks.delete(taskId)
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
        ...(task.files?.length ? {files: task.files} : {}),
        taskId,
        type: task.type,
      })
    } else {
      // Fallback if task not found
      this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.STARTED, {taskId})
    }
  }

  private registerLlmEvent<E extends LlmEventName>(eventName: E): void {
    this.transport.onRequest<LlmEventPayloadMap[E], void>(eventName, (data) => {
      this.routeLlmEvent(eventName, data as unknown as {[key: string]: unknown; taskId: string})
    })
  }

  /**
   * Generic handler for routing LLM events from Agent to clients.
   * Routes directly to task owner + broadcast-room for monitoring.
   *
   * All llmservice:* events follow the same routing pattern:
   * 1. Extract taskId from payload
   * 2. Check if task is still active (not completed/cancelled/errored)
   * 3. Send to task owner + broadcast-room if active
   * 4. Drop silently if task already ended (prevents events-after-terminal)
   */
  private routeLlmEvent(eventName: string, data: {[key: string]: unknown; taskId: string}): void {
    const {taskId, ...rest} = data
    const task = this.tasks.get(taskId)

    // Guard: Drop events for tasks that have already ended (terminal state reached)
    // This prevents "ghost events" arriving after task:completed/cancelled/error
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

        if (!this.agentClientId) {
          return {error: 'Agent not connected', success: false}
        }

        // Forward restart command to Agent
        this.transport.sendTo(this.agentClientId, TransportAgentEventNames.RESTART, {reason: data.reason})

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
  }

  /**
   * Setup Agent-related handlers.
   * These handle events FROM the Agent.
   */
  private setupAgentHandlers(): void {
    // Agent registration
    this.transport.onRequest<Record<string, never>, {success: boolean}>(
      TransportAgentEventNames.REGISTER,
      (_data, clientId) => {
        this.handleAgentRegister(clientId)
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
   * Setup connection event handlers.
   */
  private setupConnectionHandlers(): void {
    this.transport.onConnection((clientId) => {
      transportLog(`Client connected: ${clientId}`)
    })

    this.transport.onDisconnection((clientId) => {
      transportLog(`Client disconnected: ${clientId}`)

      // Check if Agent disconnected
      if (clientId === this.agentClientId) {
        transportLog('Agent disconnected!')
        this.agentClientId = undefined

        // Broadcast to all clients
        this.transport.broadcast(TransportAgentEventNames.DISCONNECTED, {})

        // Fail all pending tasks - send to client AND broadcast-room for TUI monitoring
        const error = serializeTaskError(new AgentDisconnectedError())
        for (const [taskId, task] of this.tasks) {
          this.transport.sendTo(task.clientId, TransportTaskEventNames.ERROR, {error, taskId})
          this.transport.broadcastTo('broadcast-room', TransportTaskEventNames.ERROR, {error, taskId})
        }

        this.tasks.clear()
      }
    })
  }
}
