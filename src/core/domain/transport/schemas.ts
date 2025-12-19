/**
 * Transport Schemas - 1:1 mapping with AgentEventMap
 *
 * These schemas validate messages sent over transport (Socket.IO).
 * They directly mirror the event payloads from AgentEventMap so
 * frontend receives exactly what the agent emits.
 */
import {z} from 'zod'

// ============================================================================
// Shared Schemas (used across multiple events)
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
  COMPLETED: 'task:completed',
  ERROR: 'task:error',
  STARTED: 'task:started',
} as const

export const LlmEventNames = {
  // LLM events (forwarded with original Agent names)
  RESPONSE: 'llmservice:response',
  TOOL_CALL: 'llmservice:toolCall',
  TOOL_RESULT: 'llmservice:toolResult',
} as const

/**
 * task:ack - Transport acknowledges task creation
 */
export const TaskAckSchema = z.object({
  taskId: z.string(),
})

/**
 * task:started - Agent begins processing the task
 * Direct send: {taskId} only
 * Broadcast: {taskId, input, type, files?}
 */
export const TaskStartedSchema = z.object({
  files: z.array(z.string()).optional(),
  input: z.string().optional(),
  taskId: z.string(),
  type: z.string().optional(),
})

/**
 * task:completed - Task finished successfully
 */
export const TaskCompletedSchema = z.object({
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
export const TaskErrorSchema = z.object({
  error: TaskErrorDataSchema,
  taskId: z.string(),
})

/**
 * llmservice:response - LLM text output (streaming chunks)
 * Original Agent event name, forwarded as-is
 */
export const LlmResponseEventSchema = z.object({
  content: z.string(),
  taskId: z.string(),
})

/**
 * llmservice:toolCall - Agent invokes a tool
 * Original Agent event name, forwarded as-is
 */
export const LlmToolCallEventSchema = z.object({
  args: z.record(z.unknown()).optional(),
  callId: z.string(),
  name: z.string(),
  taskId: z.string(),
})

/**
 * llmservice:toolResult - Tool returns result
 * Original Agent event name, forwarded as-is
 */
export const LlmToolResultEventSchema = z.object({
  callId: z.string(),
  error: z.string().optional(),
  result: z.unknown().optional(),
  success: z.boolean(),
  taskId: z.string(),
})

export type TaskAck = z.infer<typeof TaskAckSchema>
export type TaskStarted = z.infer<typeof TaskStartedSchema>
export type TaskCompleted = z.infer<typeof TaskCompletedSchema>
export type TaskErrorData = z.infer<typeof TaskErrorDataSchema>
export type TaskError = z.infer<typeof TaskErrorSchema>
export type LlmResponseEvent = z.infer<typeof LlmResponseEventSchema>
export type LlmToolCallEvent = z.infer<typeof LlmToolCallEventSchema>
export type LlmToolResultEvent = z.infer<typeof LlmToolResultEventSchema>

// ============================================================================
// Request/Response Schemas (for client → server commands)
// ============================================================================

export const TaskTypeSchema = z.enum(['curate', 'query'])

/**
 * Request to create a new task
 */
export const TaskCreateRequestSchema = z.object({
  /** Optional file paths for curate --files (max 5) */
  files: z.array(z.string()).optional(),
  /** Input content/prompt */
  input: z.string().min(1),
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
// Type Exports
// ============================================================================

export type TokenUsage = z.infer<typeof TokenUsageSchema>
export type LogLevel = z.infer<typeof LogLevelSchema>
export type UIEventType = z.infer<typeof UIEventTypeSchema>
export type ToolErrorType = z.infer<typeof ToolErrorTypeSchema>
export type AgentTerminationReason = z.infer<typeof AgentTerminationReasonSchema>
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
