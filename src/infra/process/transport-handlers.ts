/**
 * Transport Handlers - Message routing in Transport Process.
 *
 * Architecture v0.5.0:
 * - Routes messages between clients (TUI, external CLIs) and Agent
 * - Agent is a special client that registers via 'agent:register'
 * - Transport generates taskId, manages task rooms
 * - NO TaskProcessor, NO business logic (just routing)
 *
 * Message flows:
 * 1. Client → Transport: task:create {type, input}
 *    Transport → Agent: task:execute {taskId, type, input, clientId}
 *    Transport → Client: task:ack {taskId}
 *
 * 2. Agent → Transport: task:chunk {taskId, content}
 *    Transport → Client (room): task:chunk {taskId, content}
 *
 * 3. Agent → Transport: task:completed {taskId, result}
 *    Transport → Client (room): task:completed {taskId, result}
 *
 * Special events:
 * - agent:register: Agent identifies itself
 * - agent:connected / agent:disconnected: Broadcast to all clients
 */

import {randomUUID} from 'node:crypto'

import type {
  SessionCreateRequest,
  SessionCreateResponse,
  SessionInfoResponse,
  SessionListResponse,
  SessionSwitchRequest,
  SessionSwitchResponse,
  TaskCancelRequest,
  TaskCancelResponse,
  TaskCreateRequest,
  TaskCreateResponse,
} from '../../core/domain/transport/schemas.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Internal task tracking.
 */
type TaskInfo = {
  clientId: string
  createdAt: number
  taskId: string
  type: string
}

/**
 * Message sent from Transport to Agent.
 */
type TaskExecuteMessage = {
  clientId: string
  files?: string[]
  input: string
  taskId: string
  type: 'curate' | 'query'
}

/**
 * Messages from Agent to Transport (for routing to clients).
 */
type TaskChunkMessage = {content: string; taskId: string}
type TaskStartedMessage = {taskId: string}
type TaskCompletedMessage = {result: string; taskId: string}
type TaskErrorMessage = {error: string; taskId: string}
type TaskToolCallMessage = {args?: Record<string, unknown>; callId: string; name: string; taskId: string}
type TaskToolResultMessage = {callId: string; error?: string; result?: unknown; success: boolean; taskId: string}

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
  /** Current session ID (simple session management) */
  private currentSessionId: string | undefined
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
    this.currentSessionId = undefined
  }

  /**
   * Setup all message handlers.
   */
  setup(): void {
    this.setupConnectionHandlers()
    this.setupAgentHandlers()
    this.setupClientHandlers()
    this.setupSessionHandlers()
  }

  /**
   * Handle Agent registration.
   * Agent connects as Socket.IO client and sends 'agent:register'.
   */
  private handleAgentRegister(clientId: string): void {
    console.log(`[Transport] Agent registered: ${clientId}`)
    this.agentClientId = clientId

    // Broadcast to all clients that Agent is online
    this.transport.broadcast('agent:connected', {})
  }

  /**
   * Handle session:create request.
   */
  private handleSessionCreate(_data: SessionCreateRequest, _clientId: string): SessionCreateResponse {
    const sessionId = randomUUID()
    this.currentSessionId = sessionId

    console.log(`[Transport] Session created: ${sessionId}`)

    // Broadcast session switch
    this.transport.broadcast('session:switched', {sessionId})

    return {sessionId}
  }

  /**
   * Handle session:info request.
   */
  private handleSessionInfo(_clientId: string): SessionInfoResponse {
    // Create default session if none exists
    if (!this.currentSessionId) {
      this.currentSessionId = randomUUID()
    }

    return {
      session: {
        createdAt: Date.now(),
        id: this.currentSessionId,
        lastActiveAt: Date.now(),
      },
      stats: {
        completedTasks: 0,
        failedTasks: 0,
        totalTasks: this.tasks.size,
      },
    }
  }

  /**
   * Handle session:list request.
   */
  private handleSessionList(_clientId: string): SessionListResponse {
    const sessions = this.currentSessionId
      ? [
          {
            createdAt: Date.now(),
            id: this.currentSessionId,
            lastActiveAt: Date.now(),
          },
        ]
      : []

    return {sessions}
  }

  /**
   * Handle session:switch request.
   */
  private handleSessionSwitch(data: SessionSwitchRequest, _clientId: string): SessionSwitchResponse {
    this.currentSessionId = data.sessionId

    console.log(`[Transport] Session switched: ${data.sessionId}`)

    // Broadcast session switch
    this.transport.broadcast('session:switched', {sessionId: data.sessionId})

    return {success: true}
  }

  /**
   * Handle task:cancel request from client.
   */
  private handleTaskCancel(data: TaskCancelRequest, _clientId: string): TaskCancelResponse {
    const {taskId} = data

    console.log(`[Transport] Task cancel requested: ${taskId}`)

    // Forward to Agent
    if (this.agentClientId) {
      this.transport.sendTo(this.agentClientId, 'task:cancel', {taskId})
    }

    return {success: true}
  }

  /**
   * Handle task:chunk from Agent.
   * Route to clients in the task room + TUI room.
   */
  private handleTaskChunk(data: TaskChunkMessage): void {
    const {content, taskId} = data
    this.transport.broadcastTo(`task:${taskId}`, 'task:chunk', {content, taskId})
    // Also broadcast to TUI room for monitoring
    this.transport.broadcastTo('tui', 'task:chunk', {content, taskId})
  }

  /**
   * Handle task:completed from Agent.
   * Route to clients in the task room + TUI room.
   */
  private handleTaskCompleted(data: TaskCompletedMessage): void {
    const {result, taskId} = data

    console.log(`[Transport] Task completed: ${taskId}`)

    this.transport.broadcastTo(`task:${taskId}`, 'task:completed', {result, taskId})
    // Also broadcast to TUI room for monitoring
    this.transport.broadcastTo('tui', 'task:completed', {result, taskId})
    this.tasks.delete(taskId)
  }

  /**
   * Handle task:create request from client.
   * Generate taskId, add client to room, forward to Agent.
   */
  private handleTaskCreate(data: TaskCreateRequest, clientId: string): TaskCreateResponse {
    const taskId = randomUUID()

    console.log(`[Transport] Task created: ${taskId} (type=${data.type}, client=${clientId})`)

    // Track task
    this.tasks.set(taskId, {
      clientId,
      createdAt: Date.now(),
      taskId,
      type: data.type,
    })

    // Add client to task room for targeted broadcasts
    this.transport.addToRoom(clientId, `task:${taskId}`)

    // Send ack immediately (fast feedback)
    this.transport.sendTo(clientId, 'task:ack', {taskId})

    // Forward to Agent
    if (this.agentClientId) {
      const executeMsg: TaskExecuteMessage = {
        clientId,
        ...(data.files?.length ? {files: data.files} : {}),
        input: data.input,
        taskId,
        type: data.type as 'curate' | 'query',
      }
      this.transport.sendTo(this.agentClientId, 'task:execute', executeMsg)
    } else {
      // No Agent connected
      console.warn(`[Transport] No Agent connected, cannot process task ${taskId}`)
      setTimeout(() => {
        this.transport.broadcastTo(`task:${taskId}`, 'task:error', {
          error: 'Agent not available. Please wait for Agent to connect.',
          taskId,
        })
      }, 100)
    }

    return {taskId}
  }

  /**
   * Handle task:error from Agent.
   * Route to clients in the task room.
   */
  private handleTaskError(data: TaskErrorMessage): void {
    const {error, taskId} = data

    console.log(`[Transport] Task error: ${taskId} - ${error}`)

    this.transport.broadcastTo(`task:${taskId}`, 'task:error', {error, taskId})
    // Also broadcast to TUI room for monitoring
    this.transport.broadcastTo('tui', 'task:error', {error, taskId})
    this.tasks.delete(taskId)
  }

  /**
   * Handle task:started from Agent.
   * Route to clients in the task room.
   */
  private handleTaskStarted(data: TaskStartedMessage): void {
    const {taskId} = data
    this.transport.broadcastTo(`task:${taskId}`, 'task:started', {taskId})
    // Also broadcast to TUI room for monitoring
    this.transport.broadcastTo('tui', 'task:started', {taskId})
  }

  /**
   * Handle task:toolCall from Agent.
   * Route to clients in the task room.
   */
  private handleTaskToolCall(data: TaskToolCallMessage): void {
    const {taskId, ...rest} = data
    this.transport.broadcastTo(`task:${taskId}`, 'task:toolCall', {taskId, ...rest})
    // Also broadcast to TUI room for monitoring
    this.transport.broadcastTo('tui', 'task:toolCall', {taskId, ...rest})
  }

  /**
   * Handle task:toolResult from Agent.
   * Route to clients in the task room.
   */
  private handleTaskToolResult(data: TaskToolResultMessage): void {
    const {taskId, ...rest} = data
    this.transport.broadcastTo(`task:${taskId}`, 'task:toolResult', {taskId, ...rest})
    // Also broadcast to TUI room for monitoring
    this.transport.broadcastTo('tui', 'task:toolResult', {taskId, ...rest})
  }

  /**
   * Setup Agent-related handlers.
   * These handle events FROM the Agent.
   */
  private setupAgentHandlers(): void {
    // Agent registration
    this.transport.onRequest<Record<string, never>, {success: boolean}>('agent:register', (_data, clientId) => {
      this.handleAgentRegister(clientId)
      return {success: true}
    })

    // Agent task events (route to clients)
    this.transport.onRequest<TaskStartedMessage, void>('task:started', (data) => {
      this.handleTaskStarted(data)
    })

    this.transport.onRequest<TaskChunkMessage, void>('task:chunk', (data) => {
      this.handleTaskChunk(data)
    })

    this.transport.onRequest<TaskCompletedMessage, void>('task:completed', (data) => {
      this.handleTaskCompleted(data)
    })

    this.transport.onRequest<TaskErrorMessage, void>('task:error', (data) => {
      this.handleTaskError(data)
    })

    this.transport.onRequest<TaskToolCallMessage, void>('task:toolCall', (data) => {
      this.handleTaskToolCall(data)
    })

    this.transport.onRequest<TaskToolResultMessage, void>('task:toolResult', (data) => {
      this.handleTaskToolResult(data)
    })
  }

  /**
   * Setup client-related handlers.
   * These handle events FROM clients (TUI, external CLIs).
   */
  private setupClientHandlers(): void {
    // Task creation from clients
    this.transport.onRequest<TaskCreateRequest, TaskCreateResponse>('task:create', (data, clientId) =>
      this.handleTaskCreate(data, clientId),
    )

    // Task cancellation from clients
    this.transport.onRequest<TaskCancelRequest, TaskCancelResponse>('task:cancel', (data, clientId) =>
      this.handleTaskCancel(data, clientId),
    )
  }

  /**
   * Setup connection event handlers.
   */
  private setupConnectionHandlers(): void {
    this.transport.onConnection((clientId) => {
      console.log(`[Transport] Client connected: ${clientId}`)
    })

    this.transport.onDisconnection((clientId) => {
      console.log(`[Transport] Client disconnected: ${clientId}`)

      // Check if Agent disconnected
      if (clientId === this.agentClientId) {
        console.log('[Transport] Agent disconnected!')
        this.agentClientId = undefined

        // Broadcast to all clients
        this.transport.broadcast('agent:disconnected', {})

        // Fail all pending tasks
        for (const [taskId] of this.tasks) {
          this.transport.broadcastTo(`task:${taskId}`, 'task:error', {
            error: 'Agent disconnected',
            taskId,
          })
        }

        this.tasks.clear()
      }
    })
  }

  /**
   * Setup session-related handlers.
   */
  private setupSessionHandlers(): void {
    this.transport.onRequest<Record<string, never>, SessionInfoResponse>('session:info', (_data, clientId) =>
      this.handleSessionInfo(clientId),
    )

    this.transport.onRequest<Record<string, never>, SessionListResponse>('session:list', (_data, clientId) =>
      this.handleSessionList(clientId),
    )

    this.transport.onRequest<SessionCreateRequest, SessionCreateResponse>('session:create', (data, clientId) =>
      this.handleSessionCreate(data, clientId),
    )

    this.transport.onRequest<SessionSwitchRequest, SessionSwitchResponse>('session:switch', (data, clientId) =>
      this.handleSessionSwitch(data, clientId),
    )
  }
}
