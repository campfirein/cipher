/**
 * Configuration for transport server.
 */
export type TransportServerConfig = {
  /**
   * CORS origin configuration.
   * @default '*' for localhost trust
   */
  corsOrigin?: string

  /**
   * Ping interval in milliseconds for heartbeat.
   * Lower = faster disconnect detection, higher network overhead.
   */
  pingIntervalMs?: number

  /**
   * Ping timeout in milliseconds.
   * If client doesn't respond within this time, considered disconnected.
   */
  pingTimeoutMs?: number
}

/**
 * Configuration for transport client.
 */
export type TransportClientConfig = {
  /**
   * Connection timeout in milliseconds.
   */
  connectTimeoutMs?: number

  /**
   * Number of reconnection attempts before giving up.
   */
  reconnectionAttempts?: number

  /**
   * Maximum reconnection delay in milliseconds.
   */
  reconnectionDelayMaxMs?: number

  /**
   * Initial reconnection delay in milliseconds.
   */
  reconnectionDelayMs?: number

  /**
   * Default request timeout in milliseconds.
   */
  requestTimeoutMs?: number

  /**
   * Room operation timeout in milliseconds.
   */
  roomTimeoutMs?: number
}

/**
 * Standard transport event names.
 * Use these constants instead of string literals for type safety.
 *
 * Event naming convention:
 * - `entity:action` for requests (client → server)
 * - `entity:past_tense` for broadcasts (server → clients)
 */
export const TransportEvents = {
  // Room events (internal protocol)
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',

  SESSION_CLEAR: 'session:clear',
  SESSION_CREATE: 'session:create',

  SESSION_DELETE: 'session:delete',
  // Session events (client → server requests)
  SESSION_INFO: 'session:info',
  SESSION_LIST: 'session:list',
  SESSION_SWITCH: 'session:switch',
  // Session events (server → client broadcasts)
  SESSION_SWITCHED: 'session:switched',
  // Task events (server → client broadcasts)
  TASK_ACK: 'task:ack',

  TASK_CANCEL: 'task:cancel',
  TASK_CHUNK: 'task:chunk',
  TASK_COMPLETED: 'task:completed',
  // Task events (client → server requests)
  TASK_CREATE: 'task:create',
  TASK_ERROR: 'task:error',
  TASK_STARTED: 'task:started',

  TASK_UPDATE: 'task:update',
} as const

/**
 * Type for transport event names.
 */
export type TransportEventName = (typeof TransportEvents)[keyof typeof TransportEvents]

// ============================================================================
// Task Message Payloads
// ============================================================================

/**
 * Task type identifier.
 */
export type TaskType = 'curate' | 'query'

/**
 * Request payload for task:create event.
 */
export type TaskCreateRequest = {
  /** The user's prompt/instruction */
  prompt: string
  /** Type of task to execute */
  type: TaskType
}

/**
 * Response payload for task:create event.
 */
export type TaskCreateResponse = {
  /** Unique identifier for the created task */
  taskId: string
}

/**
 * Request payload for task:cancel event.
 */
export type TaskCancelRequest = {
  /** ID of the task to cancel */
  taskId: string
}

/**
 * Response payload for task:cancel event.
 */
export type TaskCancelResponse = {
  /** Whether the cancellation was successful */
  success: boolean
}

/**
 * Broadcast payload for task:ack event.
 * Sent immediately when task request is received (fast feedback).
 */
export type TaskAckPayload = {
  /** ID of the acknowledged task */
  taskId: string
}

/**
 * Broadcast payload for task:started event.
 * Sent when agent actually starts processing.
 */
export type TaskStartedPayload = {
  /** ID of the started task */
  taskId: string
}

/**
 * Broadcast payload for task:chunk event.
 * Sent for streaming output from agent.
 */
export type TaskChunkPayload = {
  /** The content chunk (streaming text) */
  content: string
  /** ID of the task producing this chunk */
  taskId: string
}

/**
 * Broadcast payload for task:update event.
 * Sent for status updates during task execution.
 */
export type TaskUpdatePayload = {
  /** Update message or status */
  message: string
  /** ID of the task */
  taskId: string
}

/**
 * Broadcast payload for task:completed event.
 */
export type TaskCompletedPayload = {
  /** Final result of the task */
  result: string
  /** ID of the completed task */
  taskId: string
}

/**
 * Broadcast payload for task:error event.
 */
export type TaskErrorPayload = {
  /** Error message */
  error: string
  /** ID of the failed task */
  taskId: string
}

// ============================================================================
// Session Message Payloads
// ============================================================================

/**
 * Session information returned by session queries.
 */
export type SessionInfo = {
  /** When the session was created */
  createdAt: number
  /** Unique session identifier */
  id: string
  /** When the session was last active */
  lastActiveAt: number
  /** Human-readable session name */
  name?: string
}

/**
 * Session statistics.
 */
export type SessionStats = {
  /** Number of completed tasks */
  completedTasks: number
  /** Number of failed tasks */
  failedTasks: number
  /** Total number of tasks in this session */
  totalTasks: number
}

/**
 * Request payload for session:info event.
 */
export type SessionInfoRequest = Record<string, never>

/**
 * Response payload for session:info event.
 */
export type SessionInfoResponse = {
  /** Current session info */
  session: SessionInfo
  /** Session statistics */
  stats: SessionStats
}

/**
 * Request payload for session:list event.
 */
export type SessionListRequest = Record<string, never>

/**
 * Response payload for session:list event.
 */
export type SessionListResponse = {
  /** List of all sessions */
  sessions: SessionInfo[]
}

/**
 * Request payload for session:create event.
 */
export type SessionCreateRequest = {
  /** Optional name for the new session */
  name?: string
}

/**
 * Response payload for session:create event.
 */
export type SessionCreateResponse = {
  /** ID of the newly created session */
  sessionId: string
}

/**
 * Request payload for session:switch event.
 */
export type SessionSwitchRequest = {
  /** ID of the session to switch to */
  sessionId: string
}

/**
 * Response payload for session:switch event.
 */
export type SessionSwitchResponse = {
  /** Whether the switch was successful */
  success: boolean
}

/**
 * Request payload for session:clear event.
 */
export type SessionClearRequest = Record<string, never>

/**
 * Response payload for session:clear event.
 */
export type SessionClearResponse = {
  /** Whether the clear was successful */
  success: boolean
}

/**
 * Request payload for session:delete event.
 */
export type SessionDeleteRequest = {
  /** ID of the session to delete */
  sessionId: string
}

/**
 * Response payload for session:delete event.
 */
export type SessionDeleteResponse = {
  /** Whether the deletion was successful */
  success: boolean
}

/**
 * Broadcast payload for session:switched event.
 * Sent to all clients when session changes.
 */
export type SessionSwitchedPayload = {
  /** ID of the new active session */
  sessionId: string
}
