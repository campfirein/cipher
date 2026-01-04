/**
 * Transport Schemas - Types and validation for Socket.IO transport layer.
 *
 * Architecture (Clean Architecture compliance):
 * - Domain types from agent-events/types.ts are the Single Source of Truth (SSOT)
 * - Transport layer IMPORTS from domain, does NOT redefine
 * - Transport events EXTEND domain types with `taskId` for routing
 * - Zod schemas provide runtime validation for transport messages
 */
import {z} from 'zod'

import type {AgentEventMap} from '../cipher/agent-events/types.js'
// Re-export domain types for convenience (SSOT: agent-events/types.ts)
export type {
  AgentTerminationReason,
  LogLevel,
  TokenUsage,
  ToolErrorType,
  UIEventType,
} from '../cipher/agent-events/types.js'

// ============================================================================
// Zod Schemas for Runtime Validation (mirrors domain types)
// ============================================================================

export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
})

export const LogLevelSchema = z.enum(['debug', 'error', 'info', 'warn'])

export const UIEventTypeSchema = z.enum(['banner', 'help', 'prompt', 'response', 'separator', 'shutdown'])

export const ToolErrorTypeSchema = z.enum([
  'CANCELLED',
  'CONFIRMATION_REJECTED',
  'EXECUTION_FAILED',
  'INTERNAL_ERROR',
  'INVALID_PARAM_TYPE',
  'INVALID_PARAMS',
  'MISSING_REQUIRED_PARAM',
  'PARAM_VALIDATION_FAILED',
  'PERMISSION_DENIED',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'TOOL_DISABLED',
  'TOOL_NOT_FOUND',
])

export const AgentTerminationReasonSchema = z.enum([
  'ABORTED',
  'ERROR',
  'GOAL',
  'MAX_TURNS',
  'PROTOCOL_VIOLATION',
  'TIMEOUT',
])

export const TodoStatusSchema = z.enum(['cancelled', 'completed', 'in_progress', 'pending'])

export const TodoItemSchema = z.object({
  activeForm: z.string(),
  content: z.string(),
  status: TodoStatusSchema,
})

// ============================================================================
// Agent Events (cipher:*)
// ============================================================================

export const ConversationResetPayloadSchema = z.object({
  sessionId: z.string(),
})

export const ExecutionStartedPayloadSchema = z.object({
  maxIterations: z.number(),
  maxTimeMs: z.number().optional(),
  sessionId: z.string(),
  startTime: z.coerce.date(),
})

export const ExecutionTerminatedPayloadSchema = z.object({
  durationMs: z.number().optional(),
  endTime: z.coerce.date(),
  error: z.any().optional(), // Error objects don't serialize well
  reason: AgentTerminationReasonSchema,
  sessionId: z.string(),
  toolCallsExecuted: z.number(),
  turnCount: z.number(),
})

export const LogPayloadSchema = z.object({
  context: z.record(z.unknown()).optional(),
  level: LogLevelSchema,
  message: z.string(),
  sessionId: z.string().optional(),
  source: z.string().optional(),
})

export const StateChangedPayloadSchema = z.object({
  field: z.string(),
  newValue: z.unknown(),
  oldValue: z.unknown().optional(),
  sessionId: z.string().optional(),
})

export const StateResetPayloadSchema = z.object({
  sessionId: z.string().optional(),
})

export const UIPayloadSchema = z.object({
  context: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  sessionId: z.string().optional(),
  type: UIEventTypeSchema,
})

// ============================================================================
// LLM Service Events (llmservice:*)
// ============================================================================

export const ChunkPayloadSchema = z.object({
  content: z.string(),
  isComplete: z.boolean().optional(),
  sessionId: z.string(),
  type: z.enum(['reasoning', 'text']),
})

export const ErrorPayloadSchema = z.object({
  code: z.string().optional(),
  error: z.string(),
  sessionId: z.string(),
})

export const OutputTruncatedPayloadSchema = z.object({
  originalLength: z.number(),
  savedToFile: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
})

export const ResponsePayloadSchema = z.object({
  content: z.string(),
  model: z.string().optional(),
  partial: z.boolean().optional(),
  provider: z.string().optional(),
  reasoning: z.string().optional(),
  sessionId: z.string(),
  tokenUsage: TokenUsageSchema.optional(),
})

export const ThinkingPayloadSchema = z.object({
  sessionId: z.string(),
})

export const ThoughtPayloadSchema = z.object({
  description: z.string(),
  sessionId: z.string(),
  subject: z.string(),
})

export const TodoUpdatedPayloadSchema = z.object({
  sessionId: z.string(),
  todos: z.array(TodoItemSchema),
})

export const ToolCallPayloadSchema = z.object({
  args: z.record(z.unknown()),
  callId: z.string().optional(),
  sessionId: z.string(),
  toolName: z.string(),
})

export const ToolResultPayloadSchema = z.object({
  callId: z.string().optional(),
  error: z.string().optional(),
  errorType: ToolErrorTypeSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  sessionId: z.string(),
  success: z.boolean(),
  toolName: z.string(),
})

export const UnsupportedInputPayloadSchema = z.object({
  reason: z.string(),
  sessionId: z.string(),
})

export const WarningPayloadSchema = z.object({
  message: z.string(),
  model: z.string().optional(),
  provider: z.string().optional(),
  sessionId: z.string(),
})

// ============================================================================
// Transport Event Names (matches AgentEventMap keys)
// ============================================================================

export const TransportEventNames = {
  // Sorted alphabetically (lint requirement)
  CHUNK: 'llmservice:chunk',
  CONVERSATION_RESET: 'cipher:conversationReset',
  ERROR: 'llmservice:error',
  EXECUTION_STARTED: 'cipher:executionStarted',
  EXECUTION_TERMINATED: 'cipher:executionTerminated',
  LOG: 'cipher:log',
  OUTPUT_TRUNCATED: 'llmservice:outputTruncated',
  RESPONSE: 'llmservice:response',
  STATE_CHANGED: 'cipher:stateChanged',
  STATE_RESET: 'cipher:stateReset',
  THINKING: 'llmservice:thinking',
  THOUGHT: 'llmservice:thought',
  TODO_UPDATED: 'llmservice:todoUpdated',
  TOOL_CALL: 'llmservice:toolCall',
  TOOL_RESULT: 'llmservice:toolResult',
  UI: 'cipher:ui',
  UNSUPPORTED_INPUT: 'llmservice:unsupportedInput',
  WARNING: 'llmservice:warning',
} as const

// ============================================================================
// Transport Event Schemas (Transport → Client)
// ============================================================================

/**
 * Transport Events - Sent to Clients (TUI, external CLIs)
 *
 * Event naming convention:
 * - task:* events are Transport-generated (lifecycle events)
 * - llmservice:* events are forwarded from Agent with ORIGINAL names
 *
 * This means FE receives the SAME event names that Agent emits internally.
 * No mapping needed - what you see is what Agent does.
 *
 * Event Flow:
 * 1. Client sends task:create → Transport generates taskId → task:ack
 * 2. Transport forwards to Agent → Agent starts → task:started
 * 3. Agent processes:
 *    - LLM generates text → llmservice:response (streaming chunks)
 *    - LLM calls a tool → llmservice:toolCall
 *    - Tool returns result → llmservice:toolResult
 * 4. Agent finishes → task:completed OR task:error
 */
export const TransportTaskEventNames = {
  // Task lifecycle (Transport-generated)
  ACK: 'task:ack',
  // Client requests
  CANCEL: 'task:cancel',
  // Task terminal states
  CANCELLED: 'task:cancelled',
  COMPLETED: 'task:completed',
  CREATE: 'task:create',
  CREATED: 'task:created',
  ERROR: 'task:error',
  // Internal (Transport → Agent)
  EXECUTE: 'task:execute',
  STARTED: 'task:started',
} as const

export const LlmEventNames = {
  // LLM events (forwarded with original Agent names)
  CHUNK: 'llmservice:chunk',
  ERROR: 'llmservice:error',
  RESPONSE: 'llmservice:response',
  THINKING: 'llmservice:thinking',
  TOOL_CALL: 'llmservice:toolCall',
  TOOL_RESULT: 'llmservice:toolResult',
  UNSUPPORTED_INPUT: 'llmservice:unsupportedInput',
} as const

/**
 * Explicit list of LLM event names for iteration.
 *
 * Avoids `Object.values(LlmEventNames)` so call sites remain readable and
 * type-safe (the list is visible and ordered intentionally).
 */
export const TransportLlmEventList = [
  LlmEventNames.THINKING,
  LlmEventNames.CHUNK,
  LlmEventNames.RESPONSE,
  LlmEventNames.TOOL_CALL,
  LlmEventNames.TOOL_RESULT,
  LlmEventNames.ERROR,
  LlmEventNames.UNSUPPORTED_INPUT,
] as const

/**
 * Transport-generated Agent lifecycle/control events (internal).
 */
export const TransportAgentEventNames = {
  CONNECTED: 'agent:connected',
  DISCONNECTED: 'agent:disconnected',
  REGISTER: 'agent:register',
  RESTART: 'agent:restart',
  RESTARTED: 'agent:restarted',
  RESTARTING: 'agent:restarting',
} as const

/**
 * Transport-generated session events (internal).
 */
export const TransportSessionEventNames = {
  CREATE: 'session:create',
  INFO: 'session:info',
  LIST: 'session:list',
  SWITCH: 'session:switch',
  SWITCHED: 'session:switched',
} as const

// ============================================================================
// Internal Transport ↔ Agent Messages
// ============================================================================

/**
 * task:execute - Transport sends task to Agent for processing
 * Internal message, not exposed to external clients
 */
export const TaskExecuteSchema = z.object({
  /** Client ID that created the task (for response routing) */
  clientId: z.string(),
  /** Client's working directory for file validation */
  clientCwd: z.string().optional(),
  /** Task content/prompt */
  content: z.string(),
  /** Optional file paths for curate --files */
  files: z.array(z.string()).optional(),
  /** Unique task identifier */
  taskId: z.string(),
  /** Task type */
  type: z.enum(['curate', 'query']),
})

/**
 * task:cancel - Transport tells Agent to cancel a task
 */
export const TaskCancelSchema = z.object({
  taskId: z.string(),
})

export type TaskExecute = z.infer<typeof TaskExecuteSchema>
export type TaskCancel = z.infer<typeof TaskCancelSchema>

// ============================================================================
// Transport LLM Events (extends domain types with taskId)
//
// Architecture: Domain types (AgentEventMap) are SSOT with sessionId.
// Transport events ADD taskId for routing while KEEPING sessionId.
// Pattern: DomainType & { taskId: string }
// ============================================================================

/**
 * llmservice:thinking - Agent started thinking
 * Extends: AgentEventMap['llmservice:thinking'] + taskId
 */
export type LlmThinkingEvent = AgentEventMap['llmservice:thinking'] & {taskId: string}

/**
 * llmservice:chunk - Streaming content chunk from Agent
 * Extends: AgentEventMap['llmservice:chunk'] + taskId
 */
export type LlmChunkEvent = AgentEventMap['llmservice:chunk'] & {taskId: string}

/**
 * llmservice:error - Error from Agent LLM service
 * Extends: AgentEventMap['llmservice:error'] + taskId
 */
export type LlmErrorEvent = AgentEventMap['llmservice:error'] & {taskId: string}

/**
 * llmservice:unsupportedInput - Agent received unsupported input
 * Extends: AgentEventMap['llmservice:unsupportedInput'] + taskId
 */
export type LlmUnsupportedInputEvent = AgentEventMap['llmservice:unsupportedInput'] & {taskId: string}

/**
 * llmservice:response - LLM text output
 * Extends: AgentEventMap['llmservice:response'] + taskId
 */
export type LlmResponseEvent = AgentEventMap['llmservice:response'] & {taskId: string}

/**
 * llmservice:toolCall - Agent invokes a tool
 * Extends: AgentEventMap['llmservice:toolCall'] + taskId
 */
export type LlmToolCallEvent = AgentEventMap['llmservice:toolCall'] & {taskId: string}

/**
 * llmservice:toolResult - Tool returns result
 * Extends: AgentEventMap['llmservice:toolResult'] + taskId
 */
export type LlmToolResultEvent = AgentEventMap['llmservice:toolResult'] & {taskId: string}

// Zod schemas for runtime validation (if needed)
export const LlmThinkingEventSchema = z.object({
  sessionId: z.string(),
  taskId: z.string(),
})

export const LlmChunkEventSchema = z.object({
  content: z.string(),
  isComplete: z.boolean().optional(),
  sessionId: z.string(),
  taskId: z.string(),
  type: z.enum(['reasoning', 'text']),
})

export const LlmErrorEventSchema = z.object({
  code: z.string().optional(),
  error: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
})

export const LlmUnsupportedInputEventSchema = z.object({
  reason: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
})

// ============================================================================
// Transport Events (Transport → Client)
// ============================================================================

/**
 * task:ack - Transport acknowledges task creation
 */
export const TaskAckSchema = z.object({
  taskId: z.string(),
})

/**
 * task:created - Broadcasted when a new task is created
 * Sent to broadcast-room for TUI monitoring
 */
export const TaskCreatedSchema = z.object({
  /** Client's working directory for file validation */
  clientCwd: z.string().optional(),
  /** Task content/prompt */
  content: z.string(),
  /** Optional file paths for curate --files */
  files: z.array(z.string()).optional(),
  /** Unique task identifier */
  taskId: z.string(),
  /** Task type (curate or query) */
  type: z.enum(['curate', 'query']),
})

/**
 * task:started - Agent begins processing the task
 * Direct send: {taskId} only
 * Broadcast: {taskId, content, type, files?, clientCwd?}
 */
export const TaskStartedEventSchema = z.object({
  /** Client's working directory for file validation */
  clientCwd: z.string().optional(),
  /** Task content/prompt */
  content: z.string().optional(),
  /** Optional file paths for curate --files */
  files: z.array(z.string()).optional(),
  /** Unique task identifier */
  taskId: z.string(),
  /** Task type (curate or query) */
  type: z.string().optional(),
})

/**
 * task:cancelled - Task was cancelled before completion
 * Terminal state: no more events should follow for this taskId
 */
export const TaskCancelledEventSchema = z.object({
  taskId: z.string(),
})

/**
 * task:completed - Task finished successfully
 */
export const TaskCompletedEventSchema = z.object({
  result: z.string(),
  taskId: z.string(),
})

/**
 * Structured error object
 * Matches TaskErrorData interface in task-error.ts
 */
export const TaskErrorDataSchema = z.object({
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  message: z.string(),
  name: z.string(),
})

/**
 * task:error - Task failed with error
 */
export const TaskErrorEventSchema = z.object({
  error: TaskErrorDataSchema,
  taskId: z.string(),
})

/**
 * llmservice:response - LLM text output
 * Matches: AgentEventMap['llmservice:response'] + taskId
 */
export const LlmResponseEventSchema = z.object({
  content: z.string(),
  model: z.string().optional(),
  partial: z.boolean().optional(),
  provider: z.string().optional(),
  reasoning: z.string().optional(),
  sessionId: z.string(),
  taskId: z.string(),
  tokenUsage: TokenUsageSchema.optional(),
})

/**
 * llmservice:toolCall - Agent invokes a tool
 * Matches: AgentEventMap['llmservice:toolCall'] + taskId
 */
export const LlmToolCallEventSchema = z.object({
  args: z.record(z.unknown()),
  callId: z.string().optional(),
  sessionId: z.string(),
  taskId: z.string(),
  toolName: z.string(),
})

/**
 * llmservice:toolResult - Tool returns result
 * Matches: AgentEventMap['llmservice:toolResult'] + taskId
 */
export const LlmToolResultEventSchema = z.object({
  callId: z.string().optional(),
  error: z.string().optional(),
  errorType: ToolErrorTypeSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  sessionId: z.string(),
  success: z.boolean(),
  taskId: z.string(),
  toolName: z.string(),
})

export type TaskAck = z.infer<typeof TaskAckSchema>
export type TaskCancelledEvent = z.infer<typeof TaskCancelledEventSchema>
export type TaskCreated = z.infer<typeof TaskCreatedSchema>
export type TaskStartedEvent = z.infer<typeof TaskStartedEventSchema>
export type TaskCompletedEvent = z.infer<typeof TaskCompletedEventSchema>
export type TaskErrorData = z.infer<typeof TaskErrorDataSchema>
export type TaskErrorEvent = z.infer<typeof TaskErrorEventSchema>
// Note: LlmResponseEvent, LlmToolCallEvent, LlmToolResultEvent are defined above
// as type aliases extending AgentEventMap (lines 335-347)

// ============================================================================
// Request/Response Schemas (for client → server commands)
// ============================================================================

export const TaskTypeSchema = z.enum(['curate', 'query'])

/**
 * Request to create a new task
 */
export const TaskCreateRequestSchema = z.object({
  /** Client's working directory for file validation */
  clientCwd: z.string().optional(),
  /** Task content/prompt */
  content: z.string().min(1),
  /** Optional file paths for curate --files (max 5) */
  files: z.array(z.string()).optional(),
  /** Task ID - generated by Client UseCase (UUID v4) */
  taskId: z.string().uuid('Invalid taskId format - must be UUID'),
  /** Task type */
  type: TaskTypeSchema,
})

/**
 * Response after task creation
 */
export const TaskCreateResponseSchema = z.object({
  /** Created task ID */
  taskId: z.string(),
})

/**
 * Request to cancel a task
 */
export const TaskCancelRequestSchema = z.object({
  taskId: z.string(),
})

/**
 * Response after task cancellation
 */
export const TaskCancelResponseSchema = z.object({
  /** Error message if cancellation failed */
  error: z.string().optional(),
  success: z.boolean(),
})

// ============================================================================
// Session Schemas (client → server commands)
// ============================================================================

/**
 * Session info returned by queries
 */
export const SessionInfoSchema = z.object({
  createdAt: z.number(),
  id: z.string(),
  lastActiveAt: z.number(),
  name: z.string().optional(),
})

/**
 * Session statistics
 */
export const SessionStatsSchema = z.object({
  completedTasks: z.number().int().nonnegative(),
  failedTasks: z.number().int().nonnegative(),
  totalTasks: z.number().int().nonnegative(),
})

/**
 * Request for session:info (empty - get current session)
 */
export const SessionInfoRequestSchema = z.object({})

/**
 * Response for session:info
 */
export const SessionInfoResponseSchema = z.object({
  session: SessionInfoSchema,
  stats: SessionStatsSchema,
})

/**
 * Request for session:list (empty - list all)
 */
export const SessionListRequestSchema = z.object({})

/**
 * Response for session:list
 */
export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionInfoSchema),
})

/**
 * Request for session:create
 */
export const SessionCreateRequestSchema = z.object({
  name: z.string().optional(),
})

/**
 * Response for session:create
 */
export const SessionCreateResponseSchema = z.object({
  sessionId: z.string(),
})

/**
 * Request for session:switch
 */
export const SessionSwitchRequestSchema = z.object({
  sessionId: z.string(),
})

/**
 * Response for session:switch
 */
export const SessionSwitchResponseSchema = z.object({
  success: z.boolean(),
})

/**
 * Broadcast when session switches (server → all clients)
 */
export const SessionSwitchedBroadcastSchema = z.object({
  sessionId: z.string(),
})

// ============================================================================
// Agent Control (agent:*)
// ============================================================================

/**
 * Request to restart/reinitialize the Agent.
 * Used when config changes (e.g., after /init) require Agent to reload.
 */
export const AgentRestartRequestSchema = z.object({
  /** Optional reason for restart (for logging) */
  reason: z.string().optional(),
})

/**
 * Response after agent restart request.
 */
export const AgentRestartResponseSchema = z.object({
  /** Error message if restart failed */
  error: z.string().optional(),
  /** Whether the restart was initiated successfully */
  success: z.boolean(),
})

// ============================================================================
// Agent Status (health check)
// ============================================================================

/**
 * Agent status event names.
 */
export const AgentStatusEventNames = {
  /** Status changed broadcast */
  STATUS_CHANGED: 'agent:status:changed',
} as const

/**
 * Agent health status for monitoring.
 * Used by Transport to check if CipherAgent is ready before forwarding tasks.
 */
export const AgentStatusSchema = z.object({
  /** Number of tasks currently processing */
  activeTasks: z.number().int().nonnegative(),
  /** Whether auth token is loaded and valid */
  hasAuth: z.boolean(),
  /** Whether BrvConfig is loaded */
  hasConfig: z.boolean(),
  /** Whether CipherAgent is initialized and ready */
  isInitialized: z.boolean(),
  /** Last initialization error message */
  lastError: z.string().optional(),
  /** Number of tasks waiting in queue */
  queuedTasks: z.number().int().nonnegative(),
})

export type AgentStatus = z.infer<typeof AgentStatusSchema>

// ============================================================================
// Type Exports
// ============================================================================

// Note: TokenUsage, LogLevel, UIEventType, ToolErrorType, AgentTerminationReason
// are re-exported from domain (agent-events/types.ts) at the top of this file

export type TodoItem = z.infer<typeof TodoItemSchema>

export type ChunkPayload = z.infer<typeof ChunkPayloadSchema>
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>
export type ToolCallPayload = z.infer<typeof ToolCallPayloadSchema>
export type ToolResultPayload = z.infer<typeof ToolResultPayloadSchema>
export type TodoUpdatedPayload = z.infer<typeof TodoUpdatedPayloadSchema>
export type ExecutionStartedPayload = z.infer<typeof ExecutionStartedPayloadSchema>
export type ExecutionTerminatedPayload = z.infer<typeof ExecutionTerminatedPayloadSchema>

export type TaskType = z.infer<typeof TaskTypeSchema>
export type TaskCreateRequest = z.infer<typeof TaskCreateRequestSchema>
export type TaskCreateResponse = z.infer<typeof TaskCreateResponseSchema>
export type TaskCancelRequest = z.infer<typeof TaskCancelRequestSchema>
export type TaskCancelResponse = z.infer<typeof TaskCancelResponseSchema>

export type SessionInfo = z.infer<typeof SessionInfoSchema>
export type SessionStats = z.infer<typeof SessionStatsSchema>
export type SessionInfoRequest = z.infer<typeof SessionInfoRequestSchema>
export type SessionInfoResponse = z.infer<typeof SessionInfoResponseSchema>
export type SessionListRequest = z.infer<typeof SessionListRequestSchema>
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>
export type SessionCreateResponse = z.infer<typeof SessionCreateResponseSchema>
export type SessionSwitchRequest = z.infer<typeof SessionSwitchRequestSchema>
export type SessionSwitchResponse = z.infer<typeof SessionSwitchResponseSchema>
export type SessionSwitchedBroadcast = z.infer<typeof SessionSwitchedBroadcastSchema>

export type AgentRestartRequest = z.infer<typeof AgentRestartRequestSchema>
export type AgentRestartResponse = z.infer<typeof AgentRestartResponseSchema>
