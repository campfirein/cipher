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
 * 1. Client → Transport: task:create {type, input}
 *    Transport → Agent: task:execute {taskId, type, input, clientId}
 *    Transport → Client: task:ack {taskId}
 *    Transport → broadcast-room: task:created {taskId, type, input, files?}
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
  TaskErrorData,
} from '../../core/domain/transport/schemas.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {
  AgentDisconnectedError,
  AgentNotAvailableError,
  serializeTaskError,
} from '../../core/domain/errors/task-error.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Internal task tracking.
 */
type TaskInfo = {
  clientId: string
  createdAt: number
  files?: string[]
  input: string
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
 *
 * Event naming convention:
 * - task:* events are Transport-generated (ack, started, completed, error)
 * - llmservice:* events are forwarded from Agent with original names
 *
 * All 7 llmservice events from session-event-forwarder.ts:
 * 1. llmservice:thinking
 * 2. llmservice:chunk
 * 3. llmservice:response
 * 4. llmservice:toolCall
 * 5. llmservice:toolResult
 * 6. llmservice:error
 * 7. llmservice:unsupportedInput
 */
type LlmThinkingMessage = {taskId: string}
type LlmChunkMessage = {content: string; isComplete?: boolean; taskId: string; type: 'reasoning' | 'text'}
type LlmResponseMessage = {content: string; taskId: string}
type LlmToolCallMessage = {args?: Record<string, unknown>; callId: string; name: string; taskId: string}
type LlmToolResultMessage = {callId: string; error?: string; result?: unknown; success: boolean; taskId: string}
type LlmErrorMessage = {code?: string; error: string; taskId: string}
type LlmUnsupportedInputMessage = {reason: string; taskId: string}
type TaskStartedMessage = {taskId: string}
type TaskCompletedMessage = {result: string; taskId: string}
type TaskErrorMessage = {error: TaskErrorData; taskId: string}

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
   * Handle llmservice:chunk from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleLlmChunk(data: LlmChunkMessage): void {
    const {taskId, ...rest} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'llmservice:chunk', {taskId, ...rest})
    }

    this.transport.broadcastTo('broadcast-room', 'llmservice:chunk', {taskId, ...rest})
  }

  /**
   * Handle llmservice:error from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleLlmError(data: LlmErrorMessage): void {
    const {taskId, ...rest} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'llmservice:error', {taskId, ...rest})
    }

    this.transport.broadcastTo('broadcast-room', 'llmservice:error', {taskId, ...rest})
  }

  /**
   * Handle llmservice:response from Agent (LLM text output chunks).
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleLlmResponse(data: LlmResponseMessage): void {
    const {content, taskId} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'llmservice:response', {content, taskId})
    }

    this.transport.broadcastTo('broadcast-room', 'llmservice:response', {content, taskId})
  }

  /**
   * Handle llmservice:thinking from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleLlmThinking(data: LlmThinkingMessage): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'llmservice:thinking', {taskId})
    }

    this.transport.broadcastTo('broadcast-room', 'llmservice:thinking', {taskId})
  }

  /**
   * Handle llmservice:toolCall from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleLlmToolCall(data: LlmToolCallMessage): void {
    const {taskId, ...rest} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'llmservice:toolCall', {taskId, ...rest})
    }

    this.transport.broadcastTo('broadcast-room', 'llmservice:toolCall', {taskId, ...rest})
  }

  /**
   * Handle llmservice:toolResult from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleLlmToolResult(data: LlmToolResultMessage): void {
    const {taskId, ...rest} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'llmservice:toolResult', {taskId, ...rest})
    }

    this.transport.broadcastTo('broadcast-room', 'llmservice:toolResult', {taskId, ...rest})
  }

  /**
   * Handle llmservice:unsupportedInput from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleLlmUnsupportedInput(data: LlmUnsupportedInputMessage): void {
    const {taskId, ...rest} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'llmservice:unsupportedInput', {taskId, ...rest})
    }

    this.transport.broadcastTo('broadcast-room', 'llmservice:unsupportedInput', {taskId, ...rest})
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
   * Handle task:completed from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleTaskCompleted(data: TaskCompletedMessage): void {
    const {result, taskId} = data
    const task = this.tasks.get(taskId)

    console.log(`[Transport] Task completed: ${taskId}`)

    if (task) {
      this.transport.sendTo(task.clientId, 'task:completed', {result, taskId})
    }

    this.transport.broadcastTo('broadcast-room', 'task:completed', {result, taskId})
    this.tasks.delete(taskId)
  }

  /**
   * Handle task:create request from client.
   * Generate taskId, add client to room, forward to Agent.
   */
  private handleTaskCreate(data: TaskCreateRequest, clientId: string): TaskCreateResponse {
    const taskId = randomUUID()

    console.log(`[Transport] Task created: ${taskId} (type=${data.type}, client=${clientId})`)

    // Track task (clientId used for direct messaging)
    this.tasks.set(taskId, {
      clientId,
      createdAt: Date.now(),
      ...(data.files?.length ? {files: data.files} : {}),
      input: data.input,
      taskId,
      type: data.type,
    })

    // Send ack immediately (fast feedback)
    this.transport.sendTo(clientId, 'task:ack', {taskId})

    // Broadcast task:created to broadcast-room for TUI monitoring
    this.transport.broadcastTo('broadcast-room', 'task:created', {
      ...(data.files?.length ? {files: data.files} : {}),
      input: data.input,
      taskId,
      type: data.type,
    })

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
      // No Agent connected - send error directly to client
      console.warn(`[Transport] No Agent connected, cannot process task ${taskId}`)
      const error = serializeTaskError(new AgentNotAvailableError())
      setTimeout(() => {
        this.transport.sendTo(clientId, 'task:error', {error, taskId})
      }, 100)
    }

    return {taskId}
  }

  /**
   * Handle task:error from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleTaskError(data: TaskErrorMessage): void {
    const {error, taskId} = data
    const task = this.tasks.get(taskId)

    console.log(`[Transport] Task error: ${taskId} - [${error.code}] ${error.message}`)

    if (task) {
      this.transport.sendTo(task.clientId, 'task:error', {error, taskId})
    }

    this.transport.broadcastTo('broadcast-room', 'task:error', {error, taskId})
    this.tasks.delete(taskId)
  }

  /**
   * Handle task:started from Agent.
   * Route directly to task owner + broadcast-room for monitoring.
   */
  private handleTaskStarted(data: TaskStartedMessage): void {
    const {taskId} = data
    const task = this.tasks.get(taskId)
    if (task) {
      this.transport.sendTo(task.clientId, 'task:started', {taskId})

      // Broadcast with full task info for monitoring
      this.transport.broadcastTo('broadcast-room', 'task:started', {
        ...(task.files?.length ? {files: task.files} : {}),
        input: task.input,
        taskId,
        type: task.type,
      })
    } else {
      // Fallback if task not found
      this.transport.broadcastTo('broadcast-room', 'task:started', {taskId})
    }
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

    // Task lifecycle events (Transport-generated names)
    this.transport.onRequest<TaskStartedMessage, void>('task:started', (data) => {
      this.handleTaskStarted(data)
    })

    this.transport.onRequest<TaskCompletedMessage, void>('task:completed', (data) => {
      this.handleTaskCompleted(data)
    })

    this.transport.onRequest<TaskErrorMessage, void>('task:error', (data) => {
      this.handleTaskError(data)
    })

    // LLM events (all 7 from session-event-forwarder.ts)
    this.transport.onRequest<LlmThinkingMessage, void>('llmservice:thinking', (data) => {
      this.handleLlmThinking(data)
    })

    this.transport.onRequest<LlmChunkMessage, void>('llmservice:chunk', (data) => {
      this.handleLlmChunk(data)
    })

    this.transport.onRequest<LlmResponseMessage, void>('llmservice:response', (data) => {
      this.handleLlmResponse(data)
    })

    this.transport.onRequest<LlmToolCallMessage, void>('llmservice:toolCall', (data) => {
      this.handleLlmToolCall(data)
    })

    this.transport.onRequest<LlmToolResultMessage, void>('llmservice:toolResult', (data) => {
      this.handleLlmToolResult(data)
    })

    this.transport.onRequest<LlmErrorMessage, void>('llmservice:error', (data) => {
      this.handleLlmError(data)
    })

    this.transport.onRequest<LlmUnsupportedInputMessage, void>('llmservice:unsupportedInput', (data) => {
      this.handleLlmUnsupportedInput(data)
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

        // Fail all pending tasks - send directly to each client
        const error = serializeTaskError(new AgentDisconnectedError())
        for (const [taskId, task] of this.tasks) {
          this.transport.sendTo(task.clientId, 'task:error', {error, taskId})
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
