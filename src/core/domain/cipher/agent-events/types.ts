/**
 * Agent-level event names for CipherAgent.
 * These events are emitted at the agent level and include sessionId in payloads.
 */
export const AGENT_EVENT_NAMES = ['cipher:conversationReset', 'cipher:stateChanged', 'cipher:stateReset'] as const

/**
 * Session-level event names for LLM service operations.
 * These events are emitted at the session level and do not include sessionId in payloads.
 */
export const SESSION_EVENT_NAMES = [
  'llmservice:thinking',
  'llmservice:chunk',
  'llmservice:response',
  'llmservice:toolCall',
  'llmservice:toolResult',
  'llmservice:error',
  'llmservice:unsupportedInput',
  'llmservice:warning',
] as const

/**
 * All event names (union of agent and session events).
 */
export const EVENT_NAMES = [...AGENT_EVENT_NAMES, ...SESSION_EVENT_NAMES] as const

/**
 * Union type of all agent event names.
 */
export type AgentEventName = (typeof AGENT_EVENT_NAMES)[number]

/**
 * Union type of all session event names.
 */
export type SessionEventName = (typeof SESSION_EVENT_NAMES)[number]

/**
 * Union type of all event names.
 */
export type EventName = (typeof EVENT_NAMES)[number]

/**
 * Token usage information for LLM responses.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * Agent-level event payloads.
 * All agent events include sessionId for tracking which session triggered the event.
 */
export interface AgentEventMap {
  /**
   * Emitted when a conversation is reset.
   * @property {string} sessionId - ID of the session being reset
   */
  'cipher:conversationReset': {
    sessionId: string
  }

  /**
   * Emitted when agent state changes.
   * @property {string} field - Name of the state field that changed
   * @property {unknown} newValue - New value
   * @property {unknown} [oldValue] - Previous value (if applicable)
   * @property {string} [sessionId] - ID of the session (optional for global state changes)
   */
  'cipher:stateChanged': {
    field: string
    newValue: unknown
    oldValue?: unknown
    sessionId?: string
  }

  /**
   * Emitted when agent state is completely reset.
   * @property {string} [sessionId] - ID of the session (optional for global state resets)
   */
  'cipher:stateReset': {
    sessionId?: string
  }

  /**
   * Session events forwarded to agent bus with sessionId added.
   */

  /**
   * Emitted when a chunk of content is received (streaming).
   * @property {string} content - Content of the chunk
   * @property {boolean} [isComplete] - Whether this is the final chunk
   * @property {string} sessionId - ID of the session
   * @property {'reasoning' | 'text'} type - Type of chunk (text or reasoning)
   */
  'llmservice:chunk': {
    content: string
    isComplete?: boolean
    sessionId: string
    type: 'reasoning' | 'text'
  }

  /**
   * Emitted when an error occurs during LLM service operation.
   * @property {string} [code] - Error code (optional)
   * @property {string} error - Error message
   * @property {string} sessionId - ID of the session
   */
  'llmservice:error': {
    code?: string
    error: string
    sessionId: string
  }

  /**
   * Emitted when LLM completes a response.
   * @property {string} content - Full response content
   * @property {string} [model] - Model identifier
   * @property {boolean} [partial] - Whether this is a partial response (e.g., max iterations reached)
   * @property {string} [provider] - LLM provider name
   * @property {string} [reasoning] - Internal reasoning (if available)
   * @property {string} sessionId - ID of the session
   * @property {TokenUsage} [tokenUsage] - Token usage statistics
   */
  'llmservice:response': {
    content: string
    model?: string
    partial?: boolean
    provider?: string
    reasoning?: string
    sessionId: string
    tokenUsage?: TokenUsage
  }

  /**
   * Emitted when LLM service starts thinking/processing.
   * @property {string} sessionId - ID of the session
   */
  'llmservice:thinking': {
    sessionId: string
  }

  /**
   * Emitted when LLM requests a tool call.
   * @property {Record<string, unknown>} args - Arguments for the tool
   * @property {string} [callId] - Unique identifier for this tool call
   * @property {string} sessionId - ID of the session
   * @property {string} toolName - Name of the tool to execute
   */
  'llmservice:toolCall': {
    args: Record<string, unknown>
    callId?: string
    sessionId: string
    toolName: string
  }

  /**
   * Emitted when a tool execution completes.
   * @property {string} [callId] - Tool call identifier
   * @property {string} [error] - Error message (if failed)
   * @property {unknown} [result] - Tool execution result
   * @property {string} sessionId - ID of the session
   * @property {boolean} success - Whether execution succeeded
   * @property {string} toolName - Name of the executed tool
   */
  'llmservice:toolResult': {
    callId?: string
    error?: string
    result?: unknown
    sessionId: string
    success: boolean
    toolName: string
  }

  /**
   * Emitted when LLM receives unsupported input.
   * @property {string} reason - Reason why input is unsupported
   * @property {string} sessionId - ID of the session
   */
  'llmservice:unsupportedInput': {
    reason: string
    sessionId: string
  }

  /**
   * Emitted when LLM service encounters a warning (e.g., max iterations reached).
   * @property {string} message - Warning message
   * @property {string} [model] - Model identifier
   * @property {string} [provider] - LLM provider name
   * @property {string} sessionId - ID of the session
   */
  'llmservice:warning': {
    message: string
    model?: string
    provider?: string
    sessionId: string
  }
}

/**
 * Session-level event payloads.
 * These are scoped to a specific session and do not include sessionId.
 */
export interface SessionEventMap {
  /**
   * Emitted when a chunk of content is received (streaming).
   * @property {string} content - Content of the chunk
   * @property {boolean} [isComplete] - Whether this is the final chunk
   * @property {'reasoning' | 'text'} type - Type of chunk (text or reasoning)
   */
  'llmservice:chunk': {
    content: string
    isComplete?: boolean
    type: 'reasoning' | 'text'
  }

  /**
   * Emitted when an error occurs during LLM service operation.
   * @property {string} [code] - Error code (optional)
   * @property {string} error - Error message
   */
  'llmservice:error': {
    code?: string
    error: string
  }

  /**
   * Emitted when LLM completes a response.
   * @property {string} content - Full response content
   * @property {string} [model] - Model identifier
   * @property {boolean} [partial] - Whether this is a partial response (e.g., max iterations reached)
   * @property {string} [provider] - LLM provider name
   * @property {string} [reasoning] - Internal reasoning (if available)
   * @property {TokenUsage} [tokenUsage] - Token usage statistics
   */
  'llmservice:response': {
    content: string
    model?: string
    partial?: boolean
    provider?: string
    reasoning?: string
    tokenUsage?: TokenUsage
  }

  /**
   * Emitted when LLM service starts thinking/processing.
   */
  'llmservice:thinking': void

  /**
   * Emitted when LLM requests a tool call.
   * @property {Record<string, unknown>} args - Arguments for the tool
   * @property {string} [callId] - Unique identifier for this tool call
   * @property {string} toolName - Name of the tool to execute
   */
  'llmservice:toolCall': {
    args: Record<string, unknown>
    callId?: string
    toolName: string
  }

  /**
   * Emitted when a tool execution completes.
   * @property {string} [callId] - Tool call identifier
   * @property {string} [error] - Error message (if failed)
   * @property {unknown} [result] - Tool execution result
   * @property {boolean} success - Whether execution succeeded
   * @property {string} toolName - Name of the executed tool
   */
  'llmservice:toolResult': {
    callId?: string
    error?: string
    result?: unknown
    success: boolean
    toolName: string
  }

  /**
   * Emitted when LLM receives unsupported input.
   * @property {string} reason - Reason why input is unsupported
   */
  'llmservice:unsupportedInput': {
    reason: string
  }

  /**
   * Emitted when LLM service encounters a warning (e.g., max iterations reached).
   * @property {string} message - Warning message
   * @property {string} [model] - Model identifier
   * @property {string} [provider] - LLM provider name
   */
  'llmservice:warning': {
    message: string
    model?: string
    provider?: string
  }
}

/**
 * Compile-time validation: Ensure all AGENT_EVENT_NAMES are in AgentEventMap.
 */
type _AgentEventNamesInMap = (typeof AGENT_EVENT_NAMES)[number] extends keyof AgentEventMap ? true : never
const _checkAgentEventNames: _AgentEventNamesInMap = true

/**
 * Compile-time validation: Ensure all SESSION_EVENT_NAMES are in SessionEventMap.
 */
type _SessionEventNamesInMap = (typeof SESSION_EVENT_NAMES)[number] extends keyof SessionEventMap ? true : never
const _checkSessionEventNames: _SessionEventNamesInMap = true

/**
 * Prevent unused variable warnings for compile-time checks.
 */
export const __compileTimeChecks = {
  _checkAgentEventNames,
  _checkSessionEventNames,
}
